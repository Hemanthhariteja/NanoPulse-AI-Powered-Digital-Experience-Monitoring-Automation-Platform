# NanoPulse database schema (MongoDB / Mongoose)

Models live in [`backend/src/models`](../backend/src/models).

## users
| Field | Type | Notes |
|---|---|---|
| name | String | required |
| email | String | unique, lowercase |
| passwordHash | String | bcrypt (cost 10), `select: false` |
| role | `admin` \| `technician` | |
| active | Boolean | inactive users cannot log in |
| preferences.theme | `light` \| `dark` \| `system` | |
| lastLoginAt, createdAt, updatedAt | Date | |

## devices
| Field | Type | Notes |
|---|---|---|
| deviceId | String (UUID) | unique; persisted by the agent across restarts |
| hostname, operatingSystem, osVersion, architecture, ipAddress | String | |
| deviceType | `workstation` \| `laptop` \| `server` \| `virtual` | |
| agentType | `python-agent` \| `simulated` | clients cannot claim `simulated` |
| capabilities | `{demoApp, safeTempDir, actions[]}` | gates `restart_demo_app` / `clear_temp_files` |
| status | `PENDING` \| `HEALTHY` \| `WARNING` \| `CRITICAL` \| `OFFLINE` | indexed |
| monitoringPaused | Boolean | graceful agent stop / simulator stopped → no offline incident |
| secretHash | String | SHA-256 of the device secret, `select: false` |
| lastHeartbeat, registeredAt | Date | |
| latest | Object | last sample incl. top processes and interfaces |
| activeRules | [String] | rules firing on the last sample |

Indexes: `deviceId` (unique), `status`, `{agentType, status}`, `lastHeartbeat`, text on `hostname`.

## telemetries
| Field | Type | Notes |
|---|---|---|
| deviceId | String | |
| cpuUsage, ramUsage, diskUsage | Number | percent |
| networkUpload, networkDownload | Number | bytes/second |
| networkConnected | Boolean | |
| uptime | Number | seconds |
| status | String | health status computed for this sample |
| simulated | Boolean | |
| timestamp | Date | server time |

Indexes: `{deviceId: 1, timestamp: -1}`; **TTL** on `timestamp` (`TELEMETRY_RETENTION_DAYS`, default 7) — the
retention policy that prevents unbounded growth. History/analytics read `$dateTrunc` bucketed aggregates.
Process lists are stored only on `devices.latest`, not per sample.

## incidents
| Field | Type | Notes |
|---|---|---|
| incidentId | String | `INC-000123`, unique (atomic counter) |
| deviceId, deviceHostname, simulated | | |
| ruleId | String | `cpu_high`, `memory_high`, `disk_high`, `network_down`, `network_traffic_abnormal`, `device_offline` |
| fingerprint | String | `<deviceId>:<ruleId>` |
| isOpen | Boolean | false only when `RESOLVED` |
| title, description, detectionReason, rootCause, recommendation | String | explainable diagnosis |
| recommendedActions | [String] | allowlisted action types |
| severity / severityRank | `INFO`/`WARNING`/`CRITICAL` → 1/2/3 | rank used for sorting |
| severityOverridden | Boolean | manual severity is not overwritten by detections |
| confidence, confidenceBreakdown | Number, `{persistence, margin, corroboration}` | |
| metrics | Mixed | evidence at last detection |
| status | `NEW`, `INVESTIGATING`, `PENDING_APPROVAL`, `REMEDIATION_IN_PROGRESS`, `RESOLVED`, `FAILED` | |
| assignedTo | ObjectId → users | |
| resolutionNotes, resolvedBy, resolvedAt, resolutionTimeSeconds | | MTTR source |
| firstDetectedAt, lastDetectedAt, occurrences, clearSamples | | dedupe & auto-resolve bookkeeping |
| timeline | `[{at, type, message, by}]` | per-incident audit trail |

Indexes: **partial unique `{fingerprint}` where `isOpen: true`** (duplicate prevention),
`{isOpen, severityRank, createdAt}`, `{status, createdAt}`, `createdAt`, `deviceId`.

## remediations
| Field | Type | Notes |
|---|---|---|
| actionId | String | `ACT-000045`, unique |
| incident / incidentId | ObjectId / String | optional (device-level actions) |
| deviceId, deviceHostname, simulated | | |
| actionType, label, riskLevel, parameters | | parameters validated per action |
| requestedBy, approvedBy, executedBy | `{id, name, type}` | |
| approvalStatus | `PENDING` \| `APPROVED` \| `REJECTED` | |
| executionStatus | `NOT_STARTED`, `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `TIMED_OUT`, `CANCELLED` | |
| executionMode | `REAL` \| `SIMULATED` | |
| executionResult | `{summary, data, verification, error, durationMs}` | |
| timeoutSeconds, queuedAt, startedAt, timeoutAt, completedAt | | sweeper enforces `timeoutAt` |
| log | `[{at, level, message}]` | execution log |

Indexes: `{deviceId, executionStatus}`, `{approvalStatus, createdAt}`, `{executionStatus, timeoutAt}`, `incident`.

## auditlogs
`userId`, `actorName`, `actorType` (`user`/`system`/`device`), `action` (e.g. `remediation.approved`),
`entityType`, `entityId`, `details`, `ip`, `timestamp`. Indexes on `timestamp`, `{entityType, entityId, timestamp}`,
`{userId, timestamp}`. Pruned daily after `auditRetentionDays` (default 90).

## settings (singleton `key: "global"`)
`thresholds{cpuWarning 70, cpuCritical 85, ramWarning 75, ramCritical 90, diskWarning 80, diskCritical 90, networkThroughputMBps 50}`,
`telemetryIntervalSeconds 10`, `offlineAfterSeconds 45`, `autoResolveAfterSamples 2`, `autoRequestRemediation false`,
`auditRetentionDays 90`, `enrollmentKey` (`select: false`), `updatedBy`.

## counters
`{_id: "incident" | "remediation", seq}` — atomic `$inc` for human-readable ids.
