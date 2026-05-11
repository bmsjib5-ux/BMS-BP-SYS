// SQLite layer for the central staging DB.
// Uses Node's built-in `node:sqlite` (experimental, no native compile).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS staged_vitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hn TEXT NOT NULL,
    patient_name TEXT,
    dep_code TEXT,
    dep_name TEXT,
    bps INTEGER,
    bpd INTEGER,
    pulse INTEGER,
    temperature REAL,
    rr INTEGER,
    spo2 INTEGER,
    bw REAL,
    height REAL,
    bmi REAL,
    measured_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT,
    hospital_location TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','committed','rejected')),
    committed_at TEXT,
    committed_vn TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_staged_status   ON staged_vitals(status);
  CREATE INDEX IF NOT EXISTS idx_staged_hospital ON staged_vitals(hospital_location);
  CREATE INDEX IF NOT EXISTS idx_staged_created  ON staged_vitals(created_at);
`);

console.log(`[db] opened ${DB_PATH}`);

export const insertVital = db.prepare(`
  INSERT INTO staged_vitals (
    hn, patient_name, dep_code, dep_name,
    bps, bpd, pulse, temperature, rr, spo2, bw, height, bmi,
    measured_at, created_by, hospital_location
  ) VALUES (
    $hn, $patient_name, $dep_code, $dep_name,
    $bps, $bpd, $pulse, $temperature, $rr, $spo2, $bw, $height, $bmi,
    $measured_at, $created_by, $hospital_location
  )
`);

export const listPending = db.prepare(`
  SELECT * FROM staged_vitals
  WHERE status = 'pending'
  ORDER BY created_at DESC
  LIMIT 500
`);

export const listAll = db.prepare(`
  SELECT * FROM staged_vitals
  ORDER BY created_at DESC
  LIMIT 500
`);

export const getById = db.prepare(`SELECT * FROM staged_vitals WHERE id = ?`);

export const commitVital = db.prepare(`
  UPDATE staged_vitals
  SET status = 'committed', committed_at = datetime('now'), committed_vn = $vn
  WHERE id = $id AND status = 'pending'
`);

export const rejectVital = db.prepare(`
  UPDATE staged_vitals
  SET status = 'rejected', committed_at = datetime('now')
  WHERE id = ? AND status = 'pending'
`);

export const deleteVital = db.prepare(`DELETE FROM staged_vitals WHERE id = ?`);
