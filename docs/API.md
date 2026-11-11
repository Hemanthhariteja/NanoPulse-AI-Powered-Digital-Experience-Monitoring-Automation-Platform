# NanoPulse REST API

Base URL: `http://localhost:5000/api`. All bodies are JSON.

**Auth types**

| Type | Header |
|---|---|
| User | `Authorization: Bearer <JWT>` (from `/auth/login`, 8 h expiry) |
| Device | `X-Device-Id: <deviceId>` + `X-Device-Secret: <secret>` (from `/devices/register`) |
| Enrollment | `enrollmentKey` in the body of `/devices/register` |

**Roles**: `admin` (everything), `technician` (read everything, update/resolve incidents, request remediations).

**Errors** always look like:

```json
{ "error": { "code": "BAD_REQUEST", "message": "Invalid request body: cpuUsage — Too big: expected number to be <=100", "details": [] } }
```

Codes: `400 BAD_REQUEST`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `413 PAYLOAD_TOO_LARGE`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR` (never includes stack traces).

**Pagination**: list endpoints accept `page` (default 1) and `limit` (default 20, max 100) and return
`{ data: [...], pagination: { page, limit, total, pages } }`.

**Rate limits**: 600 requests/min per IP on `/api` (configurable), 20 failed logins per 15 min, 60 device registrations per hour.

---

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | `200 {status:"ok", db:"up"}` or `503` when MongoDB is down |

## Authentication

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | none for the first user, then admin | Create a user. Body `{name, email, password, role?}`. The first user ever becomes `admin`. Password ≥ 8 chars with a letter and a digit. |
| POST | `/auth/login` | — | Body `{email, password}` → `{token, user}` |
| GET | `/auth/me` | user | Current user |
| PATCH | `/auth/me` | user | `{name?, preferences?: {theme: light\|dark\|system}}` |
| GET | `/auth/users` | user | Active users (for incident assignment) |

## Devices

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/devices/register` | enrollment key | Register or re-enroll an agent. Returns the device secret **once**. |
| GET | `/devices` | user | Query: `status`, `agentType` (`python-agent`/`simulated`), `search`, `sort` (`hostname,status,cpu,ram,disk,heartbeat`), pagination |
| GET | `/devices/:id` | user | Device incl. latest processes/interfaces, last 25 incidents and remediations. `:id` = deviceId |
| DELETE | `/devices/:id` | admin | Removes the device and its telemetry; closes open incidents (history kept) |

Register request:

```json
{
  "enrollmentKey": "FoGa...",
  "deviceId": "optional-existing-uuid",
  "hostname": "FIN-LT-042",
  "operatingSystem": "Windows 11",
  "osVersion": "10.0.26200",
  "architecture": "AMD64",
  "ipAddress": "192.168.1.20",
  "deviceType": "laptop",
  "agentVersion": "1.0.0",
  "capabilities": { "demoApp": true, "safeTempDir": true, "actions": ["..."] }
}
```

Response `201` (new) / `200` (re-enrolled — the previous secret stops working):

```json
{ "deviceId": "351254e2-...", "deviceSecret": "w9Q...", "telemetryIntervalSeconds": 10, "reenrolled": false }
```

## Telemetry

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/telemetry` | device | Ingest one sample → diagnostics → incidents → realtime. `202 {status, findings[], telemetryIntervalSeconds}` |
| GET | `/telemetry/:deviceId` | user | Last `limit` raw samples (default 60, max 500), oldest first |
| GET | `/telemetry/:deviceId/history` | user | `range=1h\|6h\|24h\|7d`; bucketed averages `{range, bucket, points:[{t,cpuUsage,cpuMax,ramUsage,diskUsage,networkUpload,networkDownload,samples,warning,critical}]}` |

Sample body (only the three percentages are required):

```json
{
  "cpuUsage": 42.1, "cpuCount": 8,
  "ramUsage": 63.5, "ramTotalBytes": 17179869184, "ramAvailableBytes": 6270000000,
  "diskUsage": 71.2, "diskTotalBytes": 512000000000, "diskFreeBytes": 147000000000,
  "networkUpload": 12000, "networkDownload": 480000,
  "networkBytesSent": 60930798, "networkBytesRecv": 348035785,
  "networkConnected": true, "uptimeSeconds": 86010, "ipAddress": "192.168.1.20",
  "processes": [{ "pid": 4102, "name": "chrome.exe", "cpuPercent": 12.4, "memoryPercent": 8.1, "memoryBytes": 690000000, "isDemoApp": false }],
  "interfaces": [{ "name": "Wi-Fi", "addresses": ["192.168.1.20"], "isUp": true, "speedMbps": 866 }]
}
```

`networkUpload`/`networkDownload` are bytes/second; process `cpuPercent` is normalised to total machine capacity (0–100).

## Agent channel (device auth)

| Method | Path | Description |
|---|---|---|
| GET | `/agent/config` | `{telemetryIntervalSeconds, thresholds}` |
| GET | `/agent/commands` | Atomically claims queued, approved actions for this device (→ `RUNNING`). `{commands:[{actionId, actionType, parameters, timeoutSeconds}]}` |
| POST | `/agent/commands/:actionId/result` | `{status: SUCCEEDED\|FAILED, summary, data?, verification?, error?, durationMs?, mode: REAL\|SIMULATED}`. `409` if not `RUNNING`; `404` for another device's action |
| POST | `/agent/shutdown` | Graceful stop: device goes `OFFLINE` without an offline incident. `204` |

## Incidents

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/incidents` | user | Query: `status` (any status or `OPEN`), `severity`, `deviceId`, `simulated`, `search`, `sort` (`severity,-severity,newest,oldest`), pagination |
| GET | `/incidents/:id` | user | Full incident (timeline, assignee, remediations). `:id` = `INC-000123` or ObjectId |
| PATCH | `/incidents/:id` | user | `{status?: INVESTIGATING\|FAILED, severity?, assignedTo?: userId\|null, note?}`. Transitions are validated; `409` on resolved incidents |
| POST | `/incidents/:id/resolve` | user | `{notes}` (required, ≥ 3 chars). Pending remediation requests are auto-rejected |

## Remediations

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/remediations/catalog` | user | The action allowlist with risk level, timeout and required agent capability |
| GET | `/remediations` | user | Query: `view` (`pending`, `approved`, `history`), `approvalStatus`, `executionStatus`, `deviceId`, `incidentId`, pagination |
| GET | `/remediations/history` | user | Finished actions (`SUCCEEDED, FAILED, TIMED_OUT, CANCELLED`), newest first |
| GET | `/remediations/:id` | user | One action incl. execution log. `:id` = `ACT-000045` or ObjectId |
| POST | `/remediations` | user | Request an action: `{incidentId?, deviceId?, actionType, parameters?}`. `409` for duplicates or unsupported capability |
| POST | `/remediations/:id/approve` | admin | `PENDING → APPROVED`, records `approvedBy` |
| POST | `/remediations/:id/reject` | admin | `{reason}` |
| POST | `/remediations/:id/execute` | admin | Validates and queues (`202`, `executionStatus: QUEUED`, `executionMode: REAL\|SIMULATED`). `409` unless approved / if device offline |
| POST | `/remediations/:id/cancel` | admin | Cancel while `NOT_STARTED`/`QUEUED` |

Action types: `list_top_cpu_processes {limit 1–25}`, `list_top_memory_processes {limit}`, `check_network_connectivity {}`, `network_diagnostics {}`, `clear_temp_files {olderThanHours 0–720, dryRun}`, `restart_demo_app {}`. Unknown parameters are rejected.

## Analytics

All accept `range=1h|6h|24h|7d|30d` (default 24h) except overview.

| Path | Returns |
|---|---|
| `/analytics/overview` | device counts by status/type, `healthPercentage`, fleet averages, active/resolved incidents, `avgResolutionSeconds`, open incidents by severity, pending approvals, 6 recent incidents & devices |
| `/analytics/device-health` | `trend[{t, avgCpu, avgRam, avgDisk, healthyPct, warningPct, criticalPct}]`, `statusDistribution`, per-device `availability`, `fleetAvailability` |
| `/analytics/incidents` | `trend[{t, created, critical, warning, resolved}]`, `commonProblems`, `mttrSeconds`, `mttrBySeverity`, `statusDistribution` |
| `/analytics/remediation` | `byStatus`, `successRate` (succeeded / finished), `byAction`, `approval`, `avgDurationMs` |

## Settings

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/settings` | user | thresholds, intervals, auto-resolve, audit retention (never the enrollment key) |
| PATCH | `/settings` | admin | Any of `thresholds{cpuWarning,…,networkThroughputMBps}`, `telemetryIntervalSeconds`, `offlineAfterSeconds`, `autoResolveAfterSamples`, `autoRequestRemediation`, `auditRetentionDays`. Warning must be < critical |
| GET | `/settings/enrollment-key` | admin | Reveal (audited) |
| POST | `/settings/enrollment-key/rotate` | admin | New key; existing devices are unaffected |

## Simulation (admin for writes)

| Method | Path | Description |
|---|---|---|
| GET | `/simulation` | `{running, startedAt, intervalMs, deviceCount, scenarios[], availableScenarios}` |
| POST | `/simulation/start` | `{count: 1–100 (20), intervalMs: 1000–60000 (5000)}` |
| POST | `/simulation/stop` | Stops ticks, marks virtual devices offline (paused), closes their incidents |
| POST | `/simulation/scenario` | `{scenario: high_cpu\|high_ram\|low_disk\|network_down\|restore, deviceIds?, count?}` |
| POST | `/simulation/reset` | Deletes all simulated devices and their data |

## Audit

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/audit` | user | Query: `entityType`, `entityId`, `action` (prefix), `search`, pagination. Newest first |

## Socket.IO events

Connect to the API origin with `io(url, { auth: { token } })`. Unauthenticated sockets are refused (`connect_error: unauthorized`).

| Event | Payload |
|---|---|
| `telemetry:update` | `{deviceId, hostname, simulated, status, at, metrics:{cpuUsage, ramUsage, diskUsage, networkUpload, networkDownload, networkConnected, uptimeSeconds}}` |
| `device:updated` | device summary, or `{deviceId, deleted:true}` |
| `incident:created` / `incident:updated` | incident summary (no timeline) |
| `remediation:updated` | full remediation |
| `simulation:state` | same as `GET /simulation` |
