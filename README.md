# hipdash

Live dashboard for [MTPLX](https://github.com/Mtplx/MTPLX) (a multi-token-prediction LLM
runtime). Streams per-request metrics, paged-KV cache state, system stats, and
OpenCode agent activity. Persists everything to SQLite so you get history and
restart-aware runs across sessions.

## What it shows

- **Overview** - decode tok/s, TTFT, prefill, mode, CPU%, memory%, session bank, last restart.
- **MTPLX** - live generation pipeline (tokenize -> prefill -> decode -> emit), 4-up KPI quad, 12 history charts (decode, prefill, TTFT, context size, prompt tokens, completion tokens, prefill time, avg accept %, cached tokens, verify calls, bonus, corrections), session bank history with bytes/entries chart and eviction log, active sessions table, acceptance breakdown (D1/D2/D3 bars), benchmark report with run boundaries and archive button, live recent buffer.
- **OpenCode** - agent cards from `~/.config/opencode/opencode.json` with colored per-agent identity, recent investigations table with tool histograms.
- **Computer** - CPU, memory, swap, load, disk, thermal, 15-min host chart, MTPLX/opencode/claude process tables.
- **Restarts** - full restart-event history with selectable range and per-event detail.

## Architecture

```
hipdash/
  backend/                Node + Express + better-sqlite3 (port 9090)
    src/server.js           Express server, API routes, static asset serving
    src/poller.js           Polls MTPLX (1.5s) and sidecar (3s); records snapshots,
                            metric points, request log, restart events
    src/db.js               SQLite schema + bucketed metric queries
    src/upstreams.js        Reverse proxy + SSE tap for /v1/chat/completions
    src/progress.js         Pub/sub broker for live request progress
    data/history.db         Created on first run (gitignored)
  frontend/               Vite + React 18 + TypeScript + react-router
    src/pages/              Overview, Mtplx, Opencode, System, Restarts
    src/components/         LineChart, MetricChart, LiveGeneration, BenchmarkReport,
                            SessionBankChart, SessionBankHistory, ...
    dist/                   Production build (gitignored)
  ecosystem.config.cjs    PM2 process definition
```

The backend serves both the API and the built frontend so everything sits behind one URL.

## Upstream services hipdash talks to

| service          | host               | what it provides                                       |
|------------------|--------------------|--------------------------------------------------------|
| MTPLX            | `127.0.0.1:8088`   | `/metrics`, `/health`, `/admin/sessions`, `/v1/*`     |
| sidecar          | `127.0.0.1:8002`   | `/system-stats.json`, `/opencode-*.json`              |

Override with env vars: `MTPLX_HOST`, `MTPLX_PORT`, `SIDECAR_HOST`, `SIDECAR_PORT`.

## Install & run

```bash
# 1. install backend
npm --prefix backend install

# 2. install + build frontend
npm --prefix frontend install
npm --prefix frontend run build

# 3a. dev: backend on :9090, vite dev server on :5173 with HMR
npm --prefix backend start &
npm --prefix frontend run dev

# 3b. prod (or local): backend serves the built frontend
npm --prefix backend start
# -> http://127.0.0.1:9090/
```

Or run under PM2:

```bash
pm2 start ./ecosystem.config.cjs
pm2 save
pm2 logs mtplx-dashboard
```

## Restart auto-save

The poller detects MTPLX restarts via signature changes (model + runtime_mode +
build_time + uptime_s) and host uptime resets via the sidecar. Each detected
restart writes a `restart_event` row plus a full snapshot of the upstream state
at the moment of detection.

Each restart event also defines a "run" boundary - the benchmark report shows
turns within the current run by default, with toggleable buttons for prior runs
and an `archive` button that closes the current run and starts a fresh one
without restarting MTPLX itself.

## Persistence

SQLite tables (`backend/data/history.db`):

- `snapshot` - full JSON snapshots tagged by kind (mtplx_metrics, mtplx_sessions,
  system_stats, opencode_config, opencode_tool_usage, restart events).
- `metric_point` - time series of named scalars (decode_tok_s, prefill_tok_s,
  cache_bytes, cpu_used_pct, etc.) with server-side bucketing on read.
- `request_log` - one row per distinct request (deduped by content fingerprint
  since MTPLX has no request_id). Includes the raw `latest` blob.
- `restart_event` - one row per detected restart (mtplx or host) or manual archive.
- `kv_state` - small key-value for poller state (last seen signatures).

14-day retention; hourly prune.

## API

History API (under `/api/`):

- `GET /api/status` - alive flags + last seen health
- `GET /api/history/metrics?series=a,b,c&range_ms=N[&max_points=N]` - per-series points (server-side bucketed if max_points provided)
- `GET /api/history/requests?range_ms=N&limit=N` or `?since_ts=N&until_ts=N&limit=N`
- `GET /api/history/restarts?range_ms=N`
- `GET /api/history/snapshots?kind=K&range_ms=N` / `GET /api/history/latest?kind=K`
- `GET /api/runs?target=mtplx` - run windows with per-run aggregates
- `POST /api/runs/archive` - close current run, start a new one
- `GET /api/live-progress` - SSE stream of `mtplx_progress` chunks tapped from `/v1/chat/completions` (requires opencode etc. to route through the proxy)

Pass-through proxies: `/admin/* /metrics /health /v1/* /system-stats.json /opencode-*.json`.
