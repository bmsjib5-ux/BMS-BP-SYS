// opdscreen.js — read/write vital signs against the HOSxP `opdscreen` table.
//
// Domain notes:
//   * `opdscreen` rows are keyed by `vn` (visit number), not `hn`. We have to
//     resolve today's VN for a given HN via `ovst` first.
//   * If the visit already has a screening row we UPDATE; otherwise we INSERT.
//
// Security:
//   * All string inputs (HN) are validated with a strict allowlist.
//   * Numeric fields are coerced to Number and emitted unquoted, or `NULL`
//     when missing. We never interpolate raw user text into SQL.

import { executeSqlViaApi } from './bmsSession';

// HOSxP HN values are typically digit strings; some sites prepend letters.
// Anything outside this set is rejected before we build SQL.
const HN_RE = /^[A-Za-z0-9-]{1,20}$/;

function assertHn(hn) {
  if (!hn || !HN_RE.test(String(hn).trim())) {
    throw new Error('HN ไม่ถูกต้อง (ใช้ได้เฉพาะตัวอักษร/ตัวเลข/ขีด ยาวไม่เกิน 20 ตัว)');
  }
  return String(hn).trim();
}

// Convert to a SQL number literal or "NULL". Rejects NaN/Infinity.
function num(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'NULL';
  return String(n);
}

// Quote a HN-shaped string for SQL (defense in depth — value is already
// allowlisted by assertHn before reaching here).
function qStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

// 1) Resolve today's VN for an HN.
export async function findTodaysVn(hn, session) {
  const safeHn = assertHn(hn);
  const sql = `
    SELECT o.vn, o.vstdate, o.vsttime, p.hn
    FROM ovst o
    JOIN patient p ON p.hn = o.hn
    WHERE o.hn = ${qStr(safeHn)}
      AND o.vstdate = CURRENT_DATE
    ORDER BY o.vsttime DESC
    LIMIT 1
  `;
  const res = await session.executeQuery(sql);
  if (!res.ok) return { ok: false, vn: null, message: res.message };
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row?.vn) {
    return { ok: false, vn: null, message: 'ไม่พบ visit ของ HN นี้ในวันนี้ — กรุณาลงทะเบียนผู้ป่วยก่อน' };
  }
  return { ok: true, vn: row.vn, hn: row.hn, vstdate: row.vstdate, vsttime: row.vsttime };
}

// Check if opdscreen row already exists for a given VN.
async function hasOpdscreenRow(vn, session) {
  const sql = `SELECT vn FROM opdscreen WHERE vn = ${qStr(vn)} LIMIT 1`;
  const res = await session.executeQuery(sql);
  if (!res.ok) return { ok: false, exists: false, message: res.message };
  return { ok: true, exists: !!(Array.isArray(res.data) && res.data.length) };
}

// Map our app's vitals shape onto opdscreen columns.
// Returns an array of [column, sqlLiteral] entries (numeric or NULL).
function vitalsToColumns(vitals) {
  const w = Number(vitals.weight);
  const h = Number(vitals.height);
  const bmi = (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)
    ? (w / Math.pow(h / 100, 2))
    : null;

  return [
    ['bps',         num(vitals.bpSystolic)],
    ['bpd',         num(vitals.bpDiastolic)],
    ['pulse',       num(vitals.hr)],
    ['temperature', num(vitals.temp)],
    ['rr',          num(vitals.rr)],
    ['spo2',        num(vitals.spo2)],
    ['bw',          num(vitals.weight)],
    ['height',      num(vitals.height)],
    ['bmi',         bmi == null ? 'NULL' : num(bmi.toFixed(2))],
  ];
}

// 2) Save vitals to opdscreen for HN's current visit.
//    Strategy: lookup VN → check existence → UPDATE or INSERT.
export async function saveOpdscreen(hn, vitals, session) {
  const safeHn = assertHn(hn);

  const vn = await findTodaysVn(safeHn, session);
  if (!vn.ok) return { ok: false, message: vn.message };

  const cols = vitalsToColumns(vitals);
  const exists = await hasOpdscreenRow(vn.vn, session);
  if (!exists.ok) return { ok: false, message: exists.message };

  if (exists.exists) {
    const setClause = cols.map(([k, v]) => `${k} = ${v}`).join(', ');
    const sql = `UPDATE opdscreen SET ${setClause} WHERE vn = ${qStr(vn.vn)}`;
    const res = await session.executeQuery(sql);
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true, vn: vn.vn, mode: 'update' };
  }

  // INSERT path — include vn/hn/vstdate/vsttime alongside vitals.
  // LOCALTIME (not CURRENT_TIME) so the value is TIME without time zone,
  // matching HOSxP's vsttime column under PostgreSQL.
  const baseCols = [
    ['vn',      qStr(vn.vn)],
    ['hn',      qStr(safeHn)],
    ['vstdate', 'CURRENT_DATE'],
    ['vsttime', 'LOCALTIME'],
  ];
  const all = [...baseCols, ...cols];
  const colList = all.map(([k]) => k).join(', ');
  const valList = all.map(([, v]) => v).join(', ');
  const sql = `INSERT INTO opdscreen (${colList}) VALUES (${valList})`;
  const res = await session.executeQuery(sql);
  if (!res.ok) return { ok: false, message: res.message };
  return { ok: true, vn: vn.vn, mode: 'insert' };
}

// 3) List today's screening rows (for the nurse dashboard).
//    Joins:
//      - patient        → display name (pname/fname/lname)
//      - kskdepartment  → ห้องตรวจ name from ovst.main_dep
export async function listTodaysOpdscreen(session) {
  const sql = `
    SELECT
      o.vn,
      o.hn,
      CONCAT_WS(' ', p.pname, p.fname, p.lname) AS patient_name,
      o.main_dep,
      k.department AS dep_name,
      s.bps, s.bpd, s.pulse, s.temperature, s.rr, s.spo2,
      s.bw, s.height, s.bmi,
      o.vstdate, o.vsttime
    FROM ovst o
    LEFT JOIN opdscreen s    ON s.vn = o.vn
    LEFT JOIN patient p      ON p.hn = o.hn
    LEFT JOIN kskdepartment k ON k.depcode = o.main_dep
    WHERE o.vstdate = CURRENT_DATE
    ORDER BY o.vsttime DESC
    LIMIT 200
  `;
  const res = await session.executeQuery(sql);
  if (!res.ok) return { ok: false, rows: [], message: res.message };
  return { ok: true, rows: Array.isArray(res.data) ? res.data : [] };
}
