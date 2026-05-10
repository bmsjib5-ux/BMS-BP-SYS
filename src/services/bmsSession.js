// bmsSession.js — service layer for BMS / HOSxP API access.
// Implements: retrieveBmsSession, executeSqlViaApi, extractConnectionConfig.
// See BMS-SESSION-SPECIFICATION.md for the contract.

const PASTE_JSON_URL = 'https://hosxp.net/phapi/PasteJSON';
const APP_NAME = 'BMS.Dashboard.React';
const DEFAULT_TIMEOUT_MS = 30_000;

function withTimeout(ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
}

// Strip SQL comments and collapse whitespace before sending over the wire.
// HOSxP's /api/sql tolerates either, but minified is shorter and avoids
// edge cases when URL-encoding multi-line strings.
export function minifySql(sql) {
  if (!sql) return '';
  return String(sql)
    .replace(/--[^\n\r]*/g, ' ')          // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ')    // block comments
    .replace(/\s+/g, ' ')
    .trim();
}

// Calls https://hosxp.net/phapi/PasteJSON?Action=GET&code=SESSION_ID
// Returns the parsed BmsSessionResponse on success or throws on transport error.
export async function retrieveBmsSession(sessionId) {
  if (!sessionId) {
    return { MessageCode: 400, Message: 'sessionId is required' };
  }
  const url = `${PASTE_JSON_URL}?Action=GET&code=${encodeURIComponent(sessionId)}`;
  const t = withTimeout(DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: t.signal });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return { MessageCode: res.status || 500, Message: `Invalid JSON: ${text.slice(0, 200)}` };
    }
    return json;
  } catch (err) {
    return {
      MessageCode: 500,
      Message: err?.name === 'AbortError' ? 'Session lookup timed out' : (err?.message || 'Network error'),
    };
  } finally {
    t.clear();
  }
}

// Walks the priority chain documented in the spec. Returns null if nothing
// usable is present.
export function extractConnectionConfig(sessionData) {
  const result = sessionData?.result;
  if (!result) return null;

  const kv = result.key_value || {};
  const ui = result.user_info || {};

  const apiUrl =
    kv['hosxp.api_url'] ||
    ui['hosxp.api_url'] ||
    ui.bms_url ||
    null;

  const apiAuthKey =
    kv['hosxp.api_auth_key'] ||
    ui['hosxp.api_auth_key'] ||
    ui.bms_session_code ||
    null;

  if (!apiUrl) return null;
  return {
    apiUrl: String(apiUrl).replace(/\/+$/, ''), // strip trailing slash
    apiAuthKey: apiAuthKey || null,
  };
}

// Executes a SQL string against {apiUrl}/api/sql.
// Returns { ok, status, data, message, raw }.
export async function executeSqlViaApi(sql, config) {
  if (!config?.apiUrl) {
    return { ok: false, status: 0, data: null, message: 'No API URL configured', raw: null };
  }
  const minified = minifySql(sql);
  const url = `${config.apiUrl}/api/sql?sql=${encodeURIComponent(minified)}&app=${encodeURIComponent(APP_NAME)}`;
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiAuthKey) headers.Authorization = `Bearer ${config.apiAuthKey}`;

  const t = withTimeout(DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: t.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { rawText: text };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data: null,
        message: body?.Message || body?.message || `HTTP ${res.status}`,
        raw: body,
      };
    }

    // Per spec: success body has shape { MessageCode: 200, data: [...] }
    const code = body?.MessageCode;
    if (code != null && code !== 200) {
      return {
        ok: false,
        status: res.status,
        data: null,
        message: body?.Message || `MessageCode ${code}`,
        raw: body,
      };
    }
    return {
      ok: true,
      status: res.status,
      data: Array.isArray(body?.data) ? body.data : (body?.data ?? []),
      message: body?.Message || 'OK',
      raw: body,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      message: err?.name === 'AbortError' ? 'SQL request timed out' : (err?.message || 'Network error'),
      raw: null,
    };
  } finally {
    t.clear();
  }
}
