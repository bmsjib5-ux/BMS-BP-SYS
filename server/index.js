// Central staging server — Express + SQLite.
// Endpoints all require Bearer auth except /health.
import express from 'express';
import cors from 'cors';
import {
  insertVital, listPending, listAll, getById,
  commitVital, rejectVital, deleteVital,
} from './db.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_KEY = process.env.CENTRAL_API_KEY || 'dev-key-please-change';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173')
  .split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: false }));
app.use(express.json({ limit: '1mb' }));

// Compact request log so the operator can see traffic.
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Bearer auth — applied to everything except /health.
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), service: 'bms-central' });
});

// ── Vitals: staging area ──────────────────────────────────────────────────

const num = (v) => (v === '' || v == null ? null : Number(v));

app.post('/vitals', (req, res) => {
  const b = req.body || {};
  if (!b.hn || typeof b.hn !== 'string') {
    return res.status(400).json({ ok: false, error: 'hn is required' });
  }
  try {
    const r = insertVital.run({
      hn: String(b.hn).trim(),
      patient_name: b.patient_name || null,
      dep_code: b.dep_code || null,
      dep_name: b.dep_name || null,
      bps: num(b.bps),
      bpd: num(b.bpd),
      pulse: num(b.pulse),
      temperature: num(b.temperature),
      rr: num(b.rr),
      spo2: num(b.spo2),
      bw: num(b.bw),
      height: num(b.height),
      bmi: num(b.bmi),
      measured_at: b.measured_at || null,
      created_by: b.created_by || null,
      hospital_location: b.hospital_location || null,
    });
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/vitals/pending', (_req, res) => {
  res.json({ ok: true, rows: listPending.all() });
});

app.get('/vitals/all', (_req, res) => {
  res.json({ ok: true, rows: listAll.all() });
});

app.get('/vitals/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
  const row = getById.get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, row });
});

app.post('/vitals/:id/commit', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
  const vn = req.body?.vn || null;
  const r = commitVital.run({ id, vn });
  if (r.changes === 0) {
    return res.status(404).json({ ok: false, error: 'not found or not pending' });
  }
  res.json({ ok: true, id, vn });
});

app.post('/vitals/:id/reject', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
  const r = rejectVital.run(id);
  if (r.changes === 0) {
    return res.status(404).json({ ok: false, error: 'not found or not pending' });
  }
  res.json({ ok: true, id });
});

app.delete('/vitals/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid id' });
  const r = deleteVital.run(id);
  res.json({ ok: true, deleted: r.changes });
});

// ── Boot ──────────────────────────────────────────────────────────────────

app.listen(PORT, '127.0.0.1', () => {
  console.log('━'.repeat(60));
  console.log(`[central] listening on http://127.0.0.1:${PORT}`);
  console.log(`[central] API key    : ${API_KEY}`);
  console.log(`[central] CORS origin: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log('━'.repeat(60));
});
