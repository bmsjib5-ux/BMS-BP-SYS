// Central-DB connection settings — persisted to localStorage on this device.
// Per-device config (not synced); the auth key never crosses the network
// except as a Bearer header on outbound requests.

const KEY = 'central_db_settings_v1';

const DEFAULTS = {
  enabled: false,
  baseUrl: '',
  authKey: '',
  timeoutMs: 30_000,
};

export function loadCentralDbSettings() {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveCentralDbSettings(settings) {
  const sanitized = {
    enabled: !!settings?.enabled,
    baseUrl: String(settings?.baseUrl || '').trim().replace(/\/+$/, ''),
    authKey: String(settings?.authKey || '').trim(),
    timeoutMs: Math.max(1000, parseInt(settings?.timeoutMs, 10) || 30000),
  };
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(KEY, JSON.stringify(sanitized));
  }
  return sanitized;
}

export function clearCentralDbSettings() {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
}

// Connectivity probe. Tries GET {baseUrl}/health with Bearer auth. The endpoint
// contract isn't finalized yet; refine when the backend lands.
export async function testCentralDbConnection(settings) {
  if (!settings?.baseUrl) {
    return { ok: false, status: 0, message: 'ยังไม่ได้ตั้ง URL' };
  }
  const url = String(settings.baseUrl).replace(/\/+$/, '') + '/health';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), settings.timeoutMs || 30000);
  try {
    const headers = {};
    if (settings.authKey) headers.Authorization = `Bearer ${settings.authKey}`;
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    return {
      ok: res.ok,
      status: res.status,
      message: res.ok ? 'เชื่อมต่อสำเร็จ' : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err?.name === 'AbortError' ? 'หมดเวลารอตอบ' : (err?.message || 'เชื่อมต่อไม่สำเร็จ'),
    };
  } finally {
    clearTimeout(t);
  }
}
