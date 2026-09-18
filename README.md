# Pulsewatch

An uptime and infrastructure monitoring platform: HTTP/HTTPS, API, TCP, DNS, ping and
agent-reported server monitoring, with per-phase latency breakdown, incident tracking,
alerting, public status pages and a real-time dashboard.

Monitoring is limited to targets a user explicitly configures. The workers do plain,
interval-based health checks with configurable timeouts, honour redirects only after
re-validating them, and never scan address ranges. Private, loopback, link-local and
cloud-metadata addresses are rejected before a socket is opened.

---

## 1. Architecture

```
                 ┌───────────────┐        ┌────────────────────┐
  browser ──────▶│  web (nginx)  │──/api─▶│  api (Fastify)     │
   SSE  ◀────────┤  React SPA    │        │  REST + SSE + auth │
                 └───────────────┘        └─────────┬──────────┘
                                                    │ enqueue / read
  agent ──POST /api/agent/telemetry────────────────▶│
                                                    ▼
   ┌──────────────┐  due monitors   ┌───────────┐  jobs   ┌──────────────────┐
   │  scheduler   │────────────────▶│  Redis    │────────▶│  check workers   │
   │  (leader)    │                 │  BullMQ   │         │  http/tcp/dns/…  │
   └──────┬───────┘                 └─────┬─────┘         └────────┬─────────┘
          │ retention + rollups           │ pub/sub                │ results
          ▼                               ▼                        ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ PostgreSQL: monitors, monitor_checks (partitioned), rollups,          │
   │ incidents, alert rules/deliveries, agents, metrics, status pages      │
   └───────────────────────────────────────────────────────────────────────┘
```

Processes (each is the same image with a different `ROLE`):

| Role        | Responsibility |
|-------------|----------------|
| `api`       | REST API, auth, SSE stream, `/health` `/ready` `/metrics` |
| `scheduler` | Redis-locked leader that enqueues due checks, creates monthly partitions, rolls up history, applies retention, flags dead agents |
| `worker`    | Executes checks, writes results, drives the state machine, opens/resolves incidents, fires alerts |
| `web`       | nginx serving the built SPA and proxying `/api` |

### Stack, and where it differs from the brief

* **Fastify instead of Next.js API routes, Vite React SPA instead of Next.js.** The product is a
  single authenticated dashboard behind a login — there is no SEO or first-paint argument for SSR,
  and the status pages that *do* benefit from it are cheap, cacheable JSON reads. Dropping Next
  removes a Node server from the request path, lets the SPA be served as static files by nginx, and
  keeps the API a plain HTTP service that the CLI/agent/tests can hit identically.
* **PostgreSQL with native range partitioning + rollup tables instead of a dedicated TSDB.**
  Check volume is bounded by monitor count × frequency; one partition per month with automatic
  hourly/daily aggregation keeps a single datastore and makes joins to monitors/incidents trivial.
  `monitor_checks` and `server_metrics` are partitioned so retention is a `DROP TABLE`, not a
  long-running `DELETE`.
* **Raw SQL over an ORM.** Partitioned tables, percentile aggregation and upsert-heavy rollups are
  where ORMs get in the way. Migrations are plain, ordered `.sql` files.
* **Node's own `http`/`tls` stack rather than fetch/axios** for HTTP checks: socket-level events are
  the only way to get a true DNS / TCP / TLS / TTFB / download split, and a custom `lookup` hook is
  the only clean way to pin a validated IP (which is also the DNS-rebinding defence).
* Kept from the brief: TypeScript, PostgreSQL, Redis, BullMQ, Tailwind, Recharts, Docker Compose.

### Repository layout

```
server/         API, scheduler, workers (one image)
  migrations/   ordered SQL migrations
  src/checks/   one module per monitor type + SSRF guard
  src/engine/   queue, scheduler, worker, state machine, incidents, retention
  src/alerts/   dispatcher + notification channels
  src/http/     Fastify app and routes
  test/         node:test suites
agent/          standalone telemetry agent (zero dependencies)
web/            React + Vite + Tailwind dashboard
deploy/         nginx config
```

## 2. Running it

```bash
cp .env.example .env      # edit secrets
docker compose up --build
```

Then open http://localhost:8080. Compose runs migrations and seeds a demo organisation:
`demo@pulsewatch.local` / `pulsewatch` (change `SEED_PASSWORD` before anything real).

Local development without Docker:

```bash
cd server && npm install && npm run migrate && npm run seed && npm run dev   # api
cd server && ROLE=worker npm run dev
cd server && ROLE=scheduler npm run dev
cd web    && npm install && npm run dev
```

## 3. What is implemented

Stages 1–13 from the brief are implemented as working code: schema and migrations, REST API with
session + API-key auth and RBAC, BullMQ scheduler/worker, HTTP/API/TCP/DNS/ping checks with phase
timing, the failure/recovery state machine, incidents and incident events, alert rules with
cooldowns and maintenance windows, email/Discord/Slack/generic-webhook channels, the SPA, the agent,
public status pages, the SSRF guard, tests, and the Docker deployment.

Known gaps, stated plainly rather than stubbed: the email channel needs real SMTP credentials to
deliver; ICMP ping requires the container to have `ping` with unprivileged ICMP enabled (compose sets
`net.ipv4.ping_group_range`), and falls back to a TCP reachability probe when it does not; password
reset and email verification have tokens, storage and API routes but send through the same notifier,
so they are only end-to-end once SMTP is configured.

## 4. Data retention

`organizations.retention_days` (7 / 30 / 90 / 365) governs raw `monitor_checks` and `server_metrics`.
The scheduler rolls raw checks into `monitor_check_rollups` hourly and daily before dropping expired
partitions; rollups are kept for two years, so uptime history outlives the raw samples.

## 5. Security notes

* Targets are resolved first, every resolved address is validated against the blocklist, and the
  socket then connects to that exact address — so a name that re-resolves to 169.254.169.254 between
  validation and connect cannot be reached.
* Redirects are followed only up to a configured limit and each hop is re-validated.
* Response bodies are truncated at `MAX_RESPONSE_BYTES`; keyword and JSONPath assertions run on the
  truncated buffer.
* Workers never shell out except for `ping`, which is invoked with `execFile` and an argument array
  after the host has been validated as a literal IP.
* API keys are stored as SHA-256 hashes with a visible prefix; sessions are opaque random tokens
  hashed at rest; passwords use scrypt with a per-user salt.
