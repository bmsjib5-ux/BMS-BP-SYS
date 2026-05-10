// Smoke test for BMS session + opdscreen connectivity.
// Usage: node test_smoke.mjs <SESSION_ID>
//
// Tests (read-only):
//   1. retrieveBmsSession()      — session lookup
//   2. extractConnectionConfig() — config fallback chain
//   3. SELECT VERSION()          — verify SQL endpoint reachable
//   4. SELECT * FROM opdscreen LIMIT 1 — verify table + show real column names
//   5. SELECT * FROM ovst WHERE vstdate = CURRENT_DATE LIMIT 3 — sanity check

import { retrieveBmsSession, executeSqlViaApi, extractConnectionConfig } from './src/services/bmsSession.js';

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('usage: node test_smoke.mjs <SESSION_ID>');
  process.exit(2);
}

const masked = sessionId.length > 8
  ? sessionId.slice(0, 4) + '…' + sessionId.slice(-4)
  : '***';
console.log(`session-id: ${masked}\n`);

// 1. Session lookup
console.log('▶ [1/5] retrieveBmsSession()');
const sessionData = await retrieveBmsSession(sessionId);
console.log(`   MessageCode: ${sessionData?.MessageCode}`);
console.log(`   Message:     ${sessionData?.Message ?? '(none)'}`);
if (sessionData?.MessageCode !== 200) {
  console.error('   ✗ session lookup failed — aborting');
  process.exit(1);
}
const ui = sessionData?.result?.user_info || {};
console.log(`   user.name:     ${ui.name ?? '(none)'}`);
console.log(`   user.location: ${ui.location ?? '(none)'}`);
console.log(`   user.doctor:   ${ui.doctor_code ?? '(none)'}`);

// 2. Config extraction
console.log('\n▶ [2/5] extractConnectionConfig()');
const config = extractConnectionConfig(sessionData);
if (!config) {
  console.error('   ✗ no apiUrl in session response — aborting');
  process.exit(1);
}
console.log(`   apiUrl:     ${config.apiUrl}`);
console.log(`   apiAuthKey: ${config.apiAuthKey ? '(present, ' + config.apiAuthKey.length + ' chars)' : '(none)'}`);

// 3. SELECT VERSION()
console.log('\n▶ [3/5] SELECT VERSION()');
let res = await executeSqlViaApi('SELECT VERSION() AS version', config);
if (!res.ok) {
  console.error(`   ✗ failed: status=${res.status} message=${res.message}`);
  process.exit(1);
}
console.log(`   ✓ ${res.message} — DB version: ${res.data?.[0]?.version ?? '(empty)'}`);

// 4. Inspect opdscreen columns by selecting one row
console.log('\n▶ [4/5] SELECT * FROM opdscreen LIMIT 1');
res = await executeSqlViaApi('SELECT * FROM opdscreen LIMIT 1', config);
if (!res.ok) {
  console.error(`   ✗ failed: status=${res.status} message=${res.message}`);
  console.error('     (table may not exist, or auth lacks SELECT permission)');
} else {
  const row = res.data?.[0];
  if (!row) {
    console.log('   ⚠ table reachable but empty — cannot inspect columns');
  } else {
    const cols = Object.keys(row);
    console.log(`   ✓ ${cols.length} columns: ${cols.slice(0, 12).join(', ')}${cols.length > 12 ? ', …' : ''}`);

    // Cross-check the columns this app writes against the actual schema
    const expected = ['vn', 'hn', 'bps', 'bpd', 'pulse', 'temperature', 'rr', 'spo2', 'bw', 'height', 'bmi', 'vstdate', 'vsttime'];
    const missing = expected.filter((c) => !cols.includes(c));
    if (missing.length) {
      console.log(`   ⚠ missing expected columns: ${missing.join(', ')} — saveOpdscreen() will fail on these`);
    } else {
      console.log('   ✓ all expected columns present (vn, hn, bps, bpd, pulse, temperature, rr, spo2, bw, height, bmi, vstdate, vsttime)');
    }
  }
}

// 5. Today's visits
console.log('\n▶ [5/5] SELECT … FROM ovst WHERE vstdate = CURRENT_DATE LIMIT 3');
res = await executeSqlViaApi(
  "SELECT vn, hn, vstdate, vsttime FROM ovst WHERE vstdate = CURRENT_DATE ORDER BY vsttime DESC LIMIT 3",
  config,
);
if (!res.ok) {
  console.error(`   ✗ failed: status=${res.status} message=${res.message}`);
} else {
  const rows = res.data || [];
  console.log(`   ✓ ${rows.length} visit(s) today`);
  for (const r of rows) {
    console.log(`     - vn=${r.vn}  hn=${r.hn}  ${r.vstdate} ${r.vsttime}`);
  }
}

console.log('\n✓ smoke test done');
