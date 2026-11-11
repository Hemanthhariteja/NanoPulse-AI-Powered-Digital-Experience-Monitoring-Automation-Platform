# NanoPulse

**AI-assisted digital experience monitoring and automation for endpoint fleets.**

NanoPulse monitors Windows endpoints with a lightweight Python agent, diagnoses problems with an explainable
deterministic rules engine, opens de-duplicated incidents, and resolves them through an approval-gated,
allowlisted remediation workflow, all visible live in a React dashboard.

> Independent educational project inspired by Digital Experience Automation (DXA) concepts. It is not affiliated
> with, and does not integrate with, any commercial DXA product.

## Problem

IT teams receive vague complaints such as "my laptop is slow" or "the internet is down", then investigate each one
by hand. NanoPulse gathers endpoint telemetry continuously, detects abnormal behaviour, proposes a *possible* root
cause with an auditable confidence score, and lets an administrator run a safe, pre-approved fix with one click.

## Features

| Area | What works |
|---|---|
| Monitoring | Real Windows telemetry via psutil every 10 s: CPU, RAM, disk, network rates, connectivity, uptime, top processes, interfaces |
| Diagnostics | Configurable thresholds for CPU, RAM, disk, network-down and sustained traffic, plus offline detection; explainable findings with a confidence breakdown |
| Incidents | Lifecycle NEW → INVESTIGATING → PENDING_APPROVAL → REMEDIATION_IN_PROGRESS → RESOLVED/FAILED; DB-enforced duplicate prevention; auto-resolve; assignment, notes, severity override, timeline |
| Automation | 6 allowlisted actions, approval by admin, validation on server and agent, timeouts, cancellation, verification, execution log |
| Realtime | Socket.IO with JWT handshake; live device rows, charts, incidents and remediation state; reconnection with resync |
| Simulation | 20+ virtual endpoints through the real pipeline; high CPU/RAM, low disk, network-down, restore; simulated remediation results labelled `SIMULATED` |
| Analytics | Health trend, resource trend, incident trend, most common problems, MTTR, remediation success rate, availability |
| Security | bcrypt, JWT, RBAC (admin/technician), hashed device secrets, enrollment key, zod validation, operator stripping, helmet, CORS allowlist, rate limits, audit log |

## Architecture

```
Windows endpoint ── Python agent ──HTTPS JSON (device secret)──┐
                                                                ▼
Simulator (in-process) ───────────────► Express API ── telemetryService.ingest()
                                           │            ├─ diagnostics engine (rules + confidence)
                                           │            ├─ incidentService (dedupe, auto-resolve)
                                           │            └─ remediationService (approve → queue → agent → result)
                                           ├── MongoDB (TTL telemetry, audit, incidents, remediations)
                                           └── Socket.IO ──► React dashboard ──► IT administrator
```

Details, design decisions and risks: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Technology

* **Frontend:** React 19, Vite, Tailwind CSS 4, React Router, Axios, Recharts, Lucide, Socket.IO client
* **Backend:** Node.js 22, Express 4, Mongoose 9, Socket.IO, JWT, bcryptjs, zod, helmet, express-rate-limit
* **Agent:** Python 3.10+, psutil, requests (optional scikit-learn anomaly report)
* **Tests:** Vitest + Supertest, Vitest + Testing Library, pytest

## Repository layout

```
backend/   Express API, diagnostics, incidents, remediation, simulator, tests
frontend/  React dashboard, tests
agent/     Python monitoring agent, demo app, tools, tests
docs/      Architecture, API, database, setup and demo guides
```

## Quick start

Requires Node ≥ 20, Python ≥ 3.10 and MongoDB (local or Atlas). Full guide: [docs/SETUP.md](docs/SETUP.md).

```powershell
# 1. Backend
cd backend; npm install; copy .env.example .env   # set JWT_SECRET, SEED_*_PASSWORD, MONGO_URI
npm run seed                                       # prints the agent enrollment key
npm run dev                                        # http://localhost:5000

# 2. Frontend
cd frontend; npm install; copy .env.example .env
npm run dev                                        # http://localhost:5173

# 3. Agent (on the Windows endpoint)
cd agent; python -m pip install -r requirements.txt
python -m nanopulse_agent --enrollment-key <KEY> --enable-demo-app

# 4. Simulation: Dashboard → Simulation → Start simulation
```

### Environment variables

Backend (`backend/.env.example`): `PORT`, `CORS_ORIGINS`, `MONGO_URI`, `MONGO_URI_TEST`, `JWT_SECRET` (required,
≥ 32 chars), `JWT_EXPIRES_IN`, `SEED_ADMIN_EMAIL/PASSWORD`, `SEED_TECH_EMAIL/PASSWORD`, `TELEMETRY_RETENTION_DAYS`,
`REMEDIATION_GRACE_SECONDS`, `SWEEP_INTERVAL_MS`, `SIMULATOR_INTERVAL_MS`, `RATE_LIMIT_PER_MINUTE`,
`LOGIN_RATE_LIMIT_PER_15_MIN`, `LOG_LEVEL`.
Frontend (`frontend/.env.example`): `VITE_API_URL`, optional `VITE_SOCKET_URL`.
Agent: `NANOPULSE_SERVER_URL`, `NANOPULSE_ENROLLMENT_KEY`, `NANOPULSE_INTERVAL`, `NANOPULSE_SAFE_TEMP_DIR`,
`NANOPULSE_LOG_LEVEL`.

## Diagnostics and confidence

| Rule | Warning | Critical |
|---|---|---|
| CPU | ≥ 70 % | > 85 % |
| Memory | ≥ 75 % | > 90 % |
| Disk | ≥ 80 % | > 90 % |
| Network down | — | connectivity probes fail |
| Abnormal traffic | > 50 MB/s for 3 consecutive samples | — |
| Offline | no heartbeat for 45 s | — |

`confidence = 0.5 × persistence + 0.3 × margin + 0.2 × corroboration`. This is the strength of evidence for the
*root-cause hypothesis*, such as one dominant process. A threshold breach on its own is never presented as proof
of a cause.

## Remediation actions

| Action | Effect | Risk |
|---|---|---|
| `list_top_cpu_processes` | read-only, 1-second sampling | low |
| `list_top_memory_processes` | read-only | low |
| `check_network_connectivity` | TCP + DNS probes | low |
| `network_diagnostics` | interfaces, counters, connections | low |
| `clear_temp_files` | deletes aged files **only** inside the agent's safe temp directory | medium |
| `restart_demo_app` | restarts **only** the configured demo app | medium |

Workflow: request → admin approve → execute (validated, queued) → agent claims → runs with timeout → verifies →
result recorded → incident updated → telemetry confirms → auto-resolve.

## API

Summary below; full contracts are in [docs/API.md](docs/API.md).

```
POST /api/auth/register | /login       GET /api/auth/me
POST /api/devices/register             GET /api/devices[/:id]     DELETE /api/devices/:id
POST /api/telemetry                    GET /api/telemetry/:deviceId[/history]
GET  /api/incidents[/:id]              PATCH /api/incidents/:id   POST /api/incidents/:id/resolve
GET  /api/remediations[/history|/catalog|/:id]   POST /api/remediations
POST /api/remediations/:id/{approve,reject,execute,cancel}
GET  /api/agent/{config,commands}      POST /api/agent/commands/:id/result, /api/agent/shutdown
GET  /api/analytics/{overview,device-health,incidents,remediation}
GET|PATCH /api/settings                GET /api/settings/enrollment-key, POST …/rotate
GET  /api/simulation                   POST /api/simulation/{start,stop,scenario,reset}
GET  /api/audit                        GET /api/health
```

Database schemas: [docs/DATABASE.md](docs/DATABASE.md).

## Testing

```powershell
cd backend;  npm test            # 48 tests — auth, devices, telemetry, incidents, dedupe, remediation, RBAC, simulation, analytics
cd frontend; npm test            # 12 tests — login, dashboard loading/error, device table, incident filters, approval workflow
cd agent;    python -m pytest -q # 35 tests — collection, API client & retry, diagnostics, actions safety, agent loop
```

Backend tests use a separate database (`MONGO_URI_TEST`, default `nanopulse_test`) that they wipe, so a running
MongoDB is required.

## Demo

A scripted 5-minute walkthrough is in [docs/DEMO.md](docs/DEMO.md).

## Screenshots

Add captures to `docs/screenshots/` (dashboard, device detail, incident detail, automation center, analytics).

## Known limitations

* The simulator and background sweepers run in-process, so the backend supports one instance. Horizontal scaling
  would need a job leader and the Socket.IO Redis adapter.
* Telemetry is not buffered while the server is unreachable; the agent logs, backs off and resumes.
* An action that exceeds its timeout is reported as failed, but its worker thread is not forcibly killed.
* Without elevation, some processes and connection details are unavailable, and the agent skips them.
* The agent is run from a terminal. A Windows-service installer is not included.
* Anyone holding the enrollment key can re-enroll an existing device ID; rotate the key if it leaks.
* Root causes are heuristic hypotheses and are labelled "possible".
* JWTs are stored in `localStorage`; httpOnly cookies would be stronger against XSS.

## Future improvements

Windows service packaging and code signing; mTLS for agents; a message queue between ingestion and diagnostics;
per-device baselines and the ML anomaly module in the live pipeline; ticketing integrations; multi-tenant
organisations; more remediation actions with per-action approval policies.
#   N a n o P u l s e - A I - P o w e r e d - D i g i t a l - E x p e r i e n c e - M o n i t o r i n g - A u t o m a t i o n - P l a t f o r m  
 