# 5-minute demo walkthrough

## Before the demo

```powershell
cd backend;  npm run dev      # terminal 1 — API
cd frontend; npm run dev      # terminal 2 — dashboard
```

Keep two more terminals open in `agent/`. Open http://localhost:5173.
Optional clean start: Simulation → “Delete all simulated data”.

## Script

| # | Time | Action | Talking point |
|---|---|---|---|
| 1 | 0:00 | Sign in as admin; show the password toggle. | JWT + bcrypt; RBAC — only admins approve/execute. |
| 2 | 0:20 | Dashboard. | Every figure comes from `/api/analytics/overview`; the “Live” pill is the Socket.IO connection. |
| 3 | 0:40 | Settings → Agent setup → Reveal key. Terminal 3: `python -m nanopulse_agent --enrollment-key <KEY> --enable-demo-app` | One-time enrollment key → per-device secret (stored hashed). |
| 4 | 1:00 | Devices → your machine. | Real psutil metrics every 10 s; live chart driven by socket events. |
| 5 | 1:30 | Simulation → Start (20). | Virtual endpoints use the *same* ingest pipeline; labelled “Simulated” everywhere. |
| 6 | 2:00 | Terminal 4: `python demo_app.py --nanopulse-demo --burn-cpu` (or Simulation → High CPU). | |
| 7 | 2:20 | Incidents → **Critical CPU utilization** appears without reload. | One open incident per device+problem (partial unique index). |
| 8 | 2:40 | Open it: reason, possible root cause (demo worker), recommendation, confidence breakdown. | Deterministic rules; 0.5·persistence + 0.3·margin + 0.2·corroboration. |
| 9 | 3:10 | Request **Restart configured demo application**. | Starts “awaiting approval”; incident → PENDING_APPROVAL. |
| 10 | 3:25 | **Approve**, then **Execute**. | Allowlist validated on server and agent; no shell commands cross the wire. |
| 11 | 3:45 | Expand result: old/new PID, before/after CPU, execution log. | Real result with verification (or “SIMULATED:” label). |
| 12 | 4:10 | CPU drops; after 2 clean samples the incident auto-resolves. | History kept; MTTR feeds analytics. |
| 13 | 4:30 | Settings → Security & audit → audit log. | Every login, request, approval, execution and result is attributable. |
| 14 | 4:45 | Analytics. | Health/incident trends, common problems, MTTR, success rate, availability. |

## Backup scenarios

* **Disk:** `python tools/seed_temp.py`, then request **Clear eligible temporary files** — only aged files inside
  `agent/safe_temp` are removed.
* **Network:** Simulation → Network disconnect → **Check network connectivity**.
* **Offline:** Ctrl+C the agent (graceful, no incident) vs. killing it (offline incident after 45 s).

## Likely questions

* *Why diagnostics in Node?* One authoritative pipeline for real and simulated devices; the agent mirrors rules locally.
* *What stops a compromised server from damaging a laptop?* Name-only allowlist on both sides, strict parameter
  schemas, safe-dir containment, demo-app marker matching, approval and audit.
* *Scaling?* Indexed queries, TTL retention, bucketed aggregation; next: a queue between ingest and diagnostics,
  Socket.IO Redis adapter, leader-elected sweeper.
