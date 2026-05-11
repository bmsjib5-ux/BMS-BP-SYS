// Client for the central staging server (server/index.js).
// Reads URL + auth from localStorage (see utils/centralDbSettings.js).
import { loadCentralDbSettings } from '../utils/centralDbSettings';

export function isCentralEnabled() {
  const s = loadCentralDbSettings();
  return !!(s.enabled && s.baseUrl);
}

async function call(method, path, body) {
  const s = loadCentralDbSettings();
  if (!s.baseUrl) {
    return { ok: false, status: 0, message: 'ยังไม่ได้ตั้ง URL ของฐานกลาง' };
  }
  const url = String(s.baseUrl).replace(/\/+$/, '') + path;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), s.timeoutMs || 30000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (s.authKey) headers.Authorization = `Bearer ${s.authKey}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, message: data?.error || `HTTP ${res.status}`, raw: data };
    }
    return { ok: true, status: res.status, ...data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: err?.name === 'AbortError' ? 'หมดเวลารอตอบ' : (err?.message || 'Network error'),
    };
  } finally {
    clearTimeout(t);
  }
}

// Compute BMI on the client so the staged record carries it (server stays dumb).
function computeBmi(weight, height) {
  const w = Number(weight);
  const h = Number(height);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return null;
  return Number((w / Math.pow(h / 100, 2)).toFixed(2));
}

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

// Submit one staging record. `session` is the useBmsSession() result; the
// server stamps `created_by` + `hospital_location` from there for audit.
export async function submitVitalToCentral({ hn, patientName, vitals, measuredAt, session }) {
  return call('POST', '/vitals', {
    hn,
    patient_name: patientName || null,
    bps: numOrNull(vitals.bpSystolic),
    bpd: numOrNull(vitals.bpDiastolic),
    pulse: numOrNull(vitals.hr),
    temperature: numOrNull(vitals.temp),
    rr: numOrNull(vitals.rr),
    spo2: numOrNull(vitals.spo2),
    bw: numOrNull(vitals.weight),
    height: numOrNull(vitals.height),
    bmi: computeBmi(vitals.weight, vitals.height),
    measured_at: measuredAt || null,
    created_by: session?.userInfo?.name || null,
    hospital_location: session?.userInfo?.location || null,
  });
}

export async function listPendingFromCentral() {
  return call('GET', '/vitals/pending');
}

export async function commitOnCentral(id, vn) {
  return call('POST', `/vitals/${id}/commit`, { vn: vn || null });
}

export async function rejectOnCentral(id) {
  return call('POST', `/vitals/${id}/reject`, {});
}
