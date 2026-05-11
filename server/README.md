# BMS Central Staging Server

Express + SQLite backend that holds *pending* vital-sign records before they're
committed to HOSxP `opdscreen`.

## Run

```bash
npm install            # once, in repo root
npm run server         # starts on http://127.0.0.1:3000
```

Override config via env vars:

| Var               | Default                                              | Purpose                        |
|-------------------|------------------------------------------------------|--------------------------------|
| `PORT`            | `3000`                                               | listen port                    |
| `CENTRAL_API_KEY` | `dev-key-please-change`                              | Bearer token clients must send |
| `ALLOWED_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173`        | CORS origin allowlist (CSV)    |
| `DB_PATH`         | `server/data.db`                                     | SQLite file location           |

## Auth

All endpoints except `/health` require:

```
Authorization: Bearer <CENTRAL_API_KEY>
```

## Endpoints

| Method | Path                     | Purpose                                         |
|--------|--------------------------|-------------------------------------------------|
| GET    | `/health`                | Liveness ping (no auth)                         |
| POST   | `/vitals`                | Insert a pending record                         |
| GET    | `/vitals/pending`        | List records with `status = 'pending'`          |
| GET    | `/vitals/all`            | List all records (incl. committed/rejected)    |
| GET    | `/vitals/:id`            | Get one record                                  |
| POST   | `/vitals/:id/commit`     | Mark as committed (body `{ vn }` optional)      |
| POST   | `/vitals/:id/reject`     | Mark as rejected                                |
| DELETE | `/vitals/:id`            | Hard delete (testing only)                      |

### POST `/vitals` body

```jsonc
{
  "hn": "000296559",            // required
  "patient_name": "นาย มนตรี อินตะ",
  "dep_code": "001",
  "dep_name": "OPD อายุรกรรม",
  "bps": 129, "bpd": 81, "pulse": 91,
  "temperature": 36.8, "rr": 18, "spo2": 98,
  "bw": 65.5, "height": 170, "bmi": 22.7,
  "measured_at": "2026-05-10 08:30",
  "created_by": "นาง ก. (พยาบาล)",
  "hospital_location": "โรงพยาบาลพิบูลมังสาหาร"
}
```

Returns `{ ok: true, id: <number> }`.

### Status lifecycle

```
pending → committed   (POST /vitals/:id/commit, records committed_vn)
pending → rejected    (POST /vitals/:id/reject)
```

## Schema

See [db.js](db.js) — single table `staged_vitals`. WAL mode, indexes on
`status`, `hospital_location`, `created_at`.

## Migrations

Schema is applied idempotently via `CREATE TABLE IF NOT EXISTS` on every boot.
For breaking schema changes, delete `data.db` (dev) or write a migration script.
