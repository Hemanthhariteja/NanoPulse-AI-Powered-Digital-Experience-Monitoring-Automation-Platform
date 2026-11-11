# NanoPulse — Architecture

NanoPulse is an independent educational project inspired by Digital Experience
Automation (DXA) concepts. It is not affiliated with, and does not integrate
with, any commercial DXA product.

## 1. Component overview

```
 Windows endpoint                         Virtual endpoints (simulator, in backend)
 ┌──────────────────────────┐             ┌──────────────────────────────────────┐
 │ Python agent (psutil)    │             │ 20+ SimulatedDevice objects           │
 │  • collector             │             │  • randomised, controlled telemetry   │
 │  • API client + retry    │             │  • scenario injection (cpu/ram/disk/  │
 │  • command loop          │             │    network/restore)                   │
 │  • allowlisted actions   │             │  • simulated remediation results      │
 └───────────┬──────────────┘             └───────────────┬──────────────────────┘
   HTTPS JSON │ X-Device-Id / X-Device-Secret             │ same service layer
             ▼                                            ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ Node.js / Express API                                                         │
 │  routes → validation (zod) → controllers → services                           │
 │                                                                               │
 │  telemetryService.ingest()  ──► diagnostics engine (rules.js, confidence.js)  │
 │            │                         │                                        │
 │            ▼                         ▼                                        │
 │      Device / Telemetry       incidentService (fingerprint dedupe,            │
 │                                auto-resolve, lifecycle, timeline)             │
 │                                      │                                        │
 │                                      ▼                                        │
 │                        remediationService (allowlist catalog, approval,       │
 │                          dispatch queue, timeout sweeper, verification)       │
 │                                                                               │
 │  healthMonitor (offline sweeper)   auditService   analyticsService            │
 │  realtime (Socket.IO, JWT-authenticated, room "dashboard")                    │
 └───────────────┬──────────────────────────────────────────┬───────────────────┘
                 ▼                                          ▼
            MongoDB (Mongoose)                    React dashboard (Vite, Tailwind,
                                                  Recharts, Socket.IO client)
```

### Key design decisions

| Decision | Rationale |
|---|---|
| **Diagnostic engine lives in the Node backend** (`backend/src/services/diagnostics`) | All telemetry (real agents and simulator) passes through one authoritative, synchronous pipeline. Running a separate Python diagnostic service would add a second deployable and inter-process latency on every telemetry message. The Python agent ships a *mirror* of the threshold rules (`agent/nanopulse_agent/diagnostics.py`) used for local self-assessment and logging, and an optional scikit-learn anomaly report (`agent/tools/anomaly_report.py`). |
| **Agent pulls commands** (`GET /api/agent/commands`) | Endpoints sit behind NAT/firewalls; the server never opens connections to them. The agent only executes action *names* from its own allowlist — the server cannot send shell commands. |
| **Simulator runs in-process** and calls the same `telemetryService.ingest()` / `remediationService.submitResult()` used by the HTTP controllers | Simulated data goes through the same diagnostics → incident → remediation → realtime pipeline without depending on the backend's public URL (works locally and on Render). Simulated devices are flagged `agentType: "simulated"` everywhere. |
| **Device secrets hashed with SHA-256** (not bcrypt) | Secrets are 256-bit random values, so a slow KDF adds nothing, and bcrypt on every 10-second telemetry message would be wasted CPU. User passwords use bcrypt (cost 10). |
| **bcryptjs instead of native bcrypt** | Same algorithm, no native compilation toolchain on Windows. |
| **Telemetry TTL index** | Telemetry docs expire after `TELEMETRY_RETENTION_DAYS` (default 7). History queries downsample with `$dateTrunc` buckets so charts never load raw unbounded data. |
| **Enrollment key** | Agents register with an admin-visible enrollment key (Settings page, rotatable). Registration returns a per-device secret shown once. |

## 2. Data model

See [DATABASE.md](DATABASE.md) for field-level detail. Collections:
`users`, `devices`, `telemetries`, `incidents`, `remediations`, `auditlogs`, `settings`.

## 3. Diagnostic engine

Rules evaluate each telemetry sample against configurable thresholds
(Settings → Monitoring thresholds):

| Rule | Warning | Critical |
|---|---|---|
| `cpu_high` | ≥ 70 % | ≥ 85 % |
| `memory_high` | ≥ 75 % | ≥ 90 % |
| `disk_high` | ≥ 80 % | ≥ 90 % |
| `network_down` | — | agent reports no external connectivity |
| `network_traffic_abnormal` | sustained throughput above `networkThroughputMBps` for 3 consecutive samples | — |
| `device_offline` (sweeper) | no heartbeat for `offlineAfterSeconds` | — |

Each finding contains: rule id, title, severity, detection reason, metric
evidence, *possible* root cause, recommendation, recommended action types,
confidence and detection timestamp.

### Confidence methodology

Confidence expresses how strongly the available evidence supports the
*root-cause hypothesis* — not certainty that the threshold was crossed (that is
a fact). It is computed as:

```
confidence = 0.5 × persistence + 0.3 × margin + 0.2 × corroboration
```

* **persistence** — fraction of the last 5 samples (including the current one)
  that breach the warning threshold. A single spike scores low.
* **margin** — how far past the warning threshold the value is, normalised to
  the remaining headroom: `(value − warn) / (100 − warn)`, clamped 0–1.
* **corroboration** — 1.0 when an independent signal supports the hypothesis
  (e.g. a single process accounts for ≥ 40 % CPU / the top process holds ≥ 25 %
  of RAM), 0.5 when no process data is available, 0.25 when process data exists
  but load is spread out (hypothesis is weaker).

For binary rules (`network_down`, `device_offline`) margin is 1.0 and
corroboration is 0.5. The final score is rounded to two decimals. The UI shows
the three components so the score is auditable.

### Duplicate prevention and auto-resolution

* Each finding has a fingerprint `"<deviceId>:<ruleId>"`.
* An incident is **open** while its status is not `RESOLVED`. A partial unique
  index on `{ fingerprint }` where `isOpen: true` makes duplicates impossible
  even under concurrent ingestion.
* Repeated detections update `lastDetectedAt`, `occurrences`, `metrics` and
  escalate/de-escalate severity (recorded in the incident timeline).
* When the rule has not fired for `autoResolveAfterSamples` (default 2)
  consecutive samples, the incident is set to `RESOLVED` with
  `resolvedBy: "system"` and a note. The record is kept for history.

## 4. Incident lifecycle

```
NEW → INVESTIGATING → PENDING_APPROVAL → REMEDIATION_IN_PROGRESS → RESOLVED
                                                     └──────────→ FAILED
```

* `FAILED` means a remediation attempt failed. The incident stays *open*
  (dedupe still applies) so a technician can retry or resolve it manually.
* Manual transitions are validated against an allowed-transition table.
* Every change is appended to `incident.timeline` and to the audit log.

## 5. Remediation workflow

```
finding ─► recommended remediation (PENDING approval)
       ─► admin approves / rejects        (approvedBy recorded, audit logged)
       ─► admin executes                  executionStatus QUEUED
       ─► agent / simulator picks up      executionStatus RUNNING
       ─► allowlisted handler runs with timeout
       ─► agent verifies system state     (post-action snapshot)
       ─► result submitted                SUCCEEDED / FAILED  (or TIMED_OUT by sweeper)
       ─► incident updated, realtime event, audit entry
```

Allowlisted actions (`backend/src/services/remediation/catalog.js`, mirrored
in `agent/nanopulse_agent/actions.py`):

| actionType | Effect | Risk |
|---|---|---|
| `list_top_cpu_processes` | read-only process listing | low |
| `list_top_memory_processes` | read-only process listing | low |
| `check_network_connectivity` | TCP/DNS probes to configured hosts | low |
| `network_diagnostics` | interfaces, addresses, counters, connection summary | low |
| `clear_temp_files` | deletes files older than N hours **only inside the agent's configured safe directory** | medium |
| `restart_demo_app` | restarts only the explicitly configured demo application (matched by command-line marker) | medium |

Every action requires approval. Parameters are validated by the backend
(zod schema per action) *and* again by the agent. Queued actions can be
cancelled. Simulated devices return results explicitly labelled
`"mode": "SIMULATED"`.

## 6. Real-time events (Socket.IO)

Clients authenticate with the JWT in the handshake (`auth.token`) and join the
`dashboard` room. Events:

| Event | Payload |
|---|---|
| `telemetry:update` | `{ deviceId, status, metrics, at }` |
| `device:updated` | device summary (status change, registration, deletion) |
| `incident:created` / `incident:updated` | incident summary |
| `remediation:updated` | remediation summary |
| `simulation:state` | `{ running, deviceCount, scenarios }` |

The client patches local state per event; aggregate widgets refetch with a
debounce instead of reloading the page. Socket.IO's built-in reconnection is
used; on reconnect the client refetches the current view.

## 7. Security

* JWT (HS256, `JWT_SECRET`, 8h expiry) for users; roles `admin`, `technician`.
* RBAC: technicians can view everything, update incidents and *request*
  remediations; only admins approve/reject/execute, delete devices, change
  settings, manage simulation and view the enrollment key.
* Device auth: `X-Device-Id` + `X-Device-Secret` (SHA-256 compared with
  `timingSafeEqual`).
* zod validation on every body/query; Mongoose `sanitizeFilter` enabled
  globally against operator injection; `helmet`; CORS allowlist from
  `CORS_ORIGINS`; rate limiting (strict on `/api/auth/login`).
* Errors return `{ error: { code, message } }`; stack traces never leave the
  server. `passwordHash` and `secretHash` are `select: false`.

## 8. Technical risks

| Risk | Mitigation |
|---|---|
| Agent needs admin rights for some process info | Access errors are caught per process; the agent runs without elevation. |
| Telemetry growth | TTL index + bucketed history queries. |
| Incident flapping around thresholds | Auto-resolve needs N consecutive clean samples; severity changes are updates, not new incidents. |
| Duplicate incidents under concurrent writes | Partial unique index + upsert-style create that catches `E11000`. |
| Lost commands if agent offline | Queue persists in MongoDB; sweeper marks `TIMED_OUT` after `REMEDIATION_TIMEOUT_SECONDS`. |
| Free-tier hosting sleeps (Render) | Documented; the agent retries with exponential backoff. |
| Dangerous remediation | No shell execution, allowlist on both sides, safe-dir containment checks, approval + audit. |

## 9. Implementation sequence

1. Foundation — structure, config, DB, auth, app shell, basic dashboard.
2. Device monitoring — agent, registration, telemetry, device pages.
3. Diagnostics — rules, health, incidents, dedupe, auto-resolve.
4. Automation — catalog, approval, dispatch, agent actions, audit.
5. Realtime — Socket.IO server/client, live widgets, analytics.
6. Simulation — virtual devices, scenarios, UI controls.
7. Testing & docs — backend/frontend/Python tests, README, guides.
