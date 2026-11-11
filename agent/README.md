# NanoPulse monitoring agent

Lightweight Python agent (psutil + requests) that reports endpoint health to NanoPulse and runs approved,
allowlisted remediation actions.

```powershell
python -m pip install -r requirements.txt
python -m nanopulse_agent --once                       # one sample as JSON, no server
python -m nanopulse_agent --server-url http://localhost:5000 --enrollment-key <KEY> --enable-demo-app
```

## Collected

CPU %, RAM % / total / available, system-disk % / free, network rates and counters, external connectivity (TCP
probes), uptime, hostname, OS, IP, interfaces, top processes (name, PID, CPU %, memory).

**Never collected:** file contents, browser history, passwords, keystrokes, window titles, user documents. Command
lines are read locally only to recognise the demo app and are never sent.

## Modules

| File | Responsibility |
|---|---|
| `config.py` | defaults < `config.json` < env vars < CLI |
| `collector.py` | psutil metrics; per-process CPU normalised to machine capacity; demo-app children aggregated |
| `client.py` | timeouts, exponential backoff with jitter on connection errors / 429 / 5xx, `AuthError` on 401 |
| `agent.py` | registration, telemetry loop (backs off up to 6×), command loop, graceful shutdown (SIGINT/SIGTERM/SIGBREAK) |
| `actions.py` | allowlisted handlers, parameter validation, per-action timeout |
| `diagnostics.py` | local mirror of the server threshold rules |
| `state.py` | device id + secret in `state/credentials.json` (atomic write) |
| `demo_app.py` | harmless workload: idle, `--burn-cpu`, `--hold-mb N` (30-min safety limit) |
| `tools/seed_temp.py` | aged dummy files for the temp-cleanup demo |
| `tools/anomaly_report.py` | optional scikit-learn IsolationForest report over stored telemetry |

## Safety model

* The server sends only an action **name** + parameters; unknown names or extra parameters are rejected.
* No `shell=True`, no `eval`, no server-supplied paths or executables.
* `clear_temp_files` refuses root/home/Documents/Desktop/Downloads/system folders and symlinks, never follows links,
  checks containment per file, and only deletes files older than `olderThanHours` (`dryRun` supported).
* `restart_demo_app` is off unless `--enable-demo-app`; it only stops processes whose command line contains
  `demo_app.py` and `--nanopulse-demo`, then restarts the fixed configured command.
* Each action runs in a worker thread with a timeout and always reports a result.

## Tests

```powershell
python -m pytest -q
```
