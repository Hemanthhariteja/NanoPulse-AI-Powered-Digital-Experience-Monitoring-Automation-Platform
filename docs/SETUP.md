# Setup guide

## Prerequisites

| Tool | Version used during development |
|---|---|
| Node.js | 22.x (≥ 20 required) |
| Python | 3.13 (≥ 3.10 required) |
| MongoDB | 8.0 local service, or MongoDB Atlas |
| Agent OS | Windows 10/11 (target); also runs on Linux/macOS |

## 1. Database

**Local:** install MongoDB Community Server and ensure the service runs (`Get-Service MongoDB`).
Use `mongodb://127.0.0.1:27017/nanopulse` (prefer `127.0.0.1` over `localhost` on Windows to avoid IPv6 resolution).

**Atlas:** create a free M0 cluster, a database user and an IP access rule, then use the `mongodb+srv://…/nanopulse`
connection string. Indexes (including TTL and partial-unique) are created by Mongoose on startup.

## 2. Backend

```powershell
cd backend
npm install
copy .env.example .env
# edit .env: JWT_SECRET (>= 32 chars), SEED_ADMIN_PASSWORD, SEED_TECH_PASSWORD, MONGO_URI
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # generates a JWT secret
npm run seed      # creates admin + technician accounts, prints the agent enrollment key
npm run dev       # http://localhost:5000  (npm start in production)
```

Check: `curl http://localhost:5000/api/health` → `{"status":"ok","db":"up"}`.

## 3. Frontend

```powershell
cd frontend
npm install
copy .env.example .env     # VITE_API_URL=http://localhost:5000/api
npm run dev                # http://localhost:5173
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## 4. Python agent (on the Windows endpoint)

```powershell
cd agent
python -m pip install -r requirements.txt
python -m nanopulse_agent --once                      # one sample as JSON, no server needed
python -m nanopulse_agent --server-url http://localhost:5000 --enrollment-key <KEY> --enable-demo-app
```

The enrollment key is printed by `npm run seed` and shown in **Settings → Agent setup** (admin → Reveal).
After the first run, the identity is saved in `agent/state/credentials.json`; later runs need only
`python -m nanopulse_agent`. Stop with Ctrl+C — the agent tells the server it stopped intentionally.

| Option | Env | Default |
|---|---|---|
| `--server-url` | `NANOPULSE_SERVER_URL` | `http://localhost:5000` |
| `--enrollment-key` | `NANOPULSE_ENROLLMENT_KEY` | — (first run only) |
| `--interval` | `NANOPULSE_INTERVAL` | 10 s (server-advertised unless overridden) |
| `--safe-temp-dir` | `NANOPULSE_SAFE_TEMP_DIR` | `agent/safe_temp` |
| `--enable-demo-app` | | off — enables `restart_demo_app` |
| `--no-connectivity-check` | | probes 1.1.1.1:53, 8.8.8.8:53, www.microsoft.com:443 |
| `--re-register` | | discard saved credentials |
| `--log-level` | `NANOPULSE_LOG_LEVEL` | INFO; logs in `agent/logs/agent.log` (rotating) |

No administrator rights are needed; processes the agent may not inspect are skipped.

## 5. Tests

```powershell
cd backend;  npm test          # Vitest + Supertest against MONGO_URI_TEST (default nanopulse_test; wiped by tests)
cd frontend; npm test          # Vitest + Testing Library (jsdom)
cd agent;    python -m pytest -q
```

## 6. Deployment (optional)

* **Backend → Render**: `render.yaml` at the repo root defines the web service (`rootDir: backend`, `npm ci` /
  `npm start`, health check `/api/health`). Set `MONGO_URI` (Atlas), `JWT_SECRET`, `CORS_ORIGINS` (Vercel URL) and
  seed variables, then run `npm run seed` once from the Render shell.
* **Frontend → Vercel**: root `frontend`, build `npm run build`, output `dist`,
  `VITE_API_URL=https://<render-app>.onrender.com/api`. `frontend/vercel.json` rewrites routes to `index.html`.
* **Agent** runs locally with `--server-url` pointing at the Render URL.

Free Render instances sleep when idle; the agent retries with backoff. The in-process simulator and sweepers
assume a **single** backend instance.
