# Forge

**The Infrastructure Layer for Shipping Software.**

Forge is a self-hosted, production-grade PaaS that turns a GitHub repository into a live, HTTPS-served application. Connect a repo, pick a branch, set env vars, hit deploy. Forge builds the image, schedules it onto a node, runs it in an isolated container, routes traffic to it, and lets you roll back to any previous version.

Inspired by Vercel, Render and Railway, but the point of this project is the infrastructure underneath: the build engine, the deployment state machine, the scheduler, the runtime, and the reliability guarantees.

---

## What it does (end state)

1. Register, create an organization, invite members with roles.
2. Connect a GitHub repository and select a branch.
3. Configure encrypted environment variables.
4. Trigger deployments manually or via push webhooks.
5. Watch build logs stream in real time.
6. Get a public HTTPS URL (`app.forge.example.com`) and optionally a custom domain.
7. Monitor health, logs, CPU and memory from the dashboard.
8. View deployment history and roll back to any previous healthy version.
9. Run many apps across many infrastructure nodes.

---

## Architecture

Forge is split into a **Control Plane** and a **Data Plane**.

```
Developer
   │
   ▼
Next.js Dashboard
   │
   ▼
API (Express) ──────────────── Control Plane
   │                            auth, orgs, projects, GitHub,
   ├──► PostgreSQL (metadata)   webhooks, deployment orchestration,
   └──► Redis (BullMQ queues)   scheduling, quotas, usage
            │
            ▼
      Build Workers ──► Docker images ──► Registry
            │
            ▼
     Deployment Manager
            │
            ▼
      Node Scheduler ─────────────────── Data Plane
       ┌────┼────┐                       container runtime, networking,
       ▼    ▼    ▼                       health checks, log collection,
     Node1 Node2 Node3  (C++ agent each)  recovery
       │    │    │
       └────┼────┘
            ▼
     Traefik (reverse proxy, TLS)
            ▼
         Internet
```

**Control Plane** is a modular monolith plus independently deployable workers. No microservices until scale or isolation demands it.

**Data Plane** runs customer containers and must keep serving traffic even if the Control Plane is down.

Starts on a single Linux node. Designed from day one for multi-node.

---

## Tech stack

| Layer            | Choice                                        |
| ---------------- | --------------------------------------------- |
| Frontend         | Next.js, React, TypeScript, Tailwind          |
| Backend          | Node.js, TypeScript, Express, REST, WebSockets|
| Systems          | C++20 node agent (gRPC to Control Plane)      |
| Database         | PostgreSQL, Prisma                            |
| Queue            | Redis, BullMQ                                 |
| Containers       | Docker Engine API, OCI images                 |
| Proxy            | Traefik (hostname routing, auto TLS)          |
| Observability    | Prometheus, Grafana, Loki, OpenTelemetry      |
| Infra            | Docker Compose (dev), AWS EC2 + Terraform     |
| Testing          | Vitest, Playwright, GoogleTest, k6            |
| CI/CD            | GitHub Actions                                |

---

## Monorepo layout (planned)

```
forge/
├── apps/
│   ├── web/            # Next.js dashboard
│   └── api/            # Express control plane API
├── workers/
│   ├── build/          # BullMQ build worker
│   └── deploy/         # BullMQ deployment worker
├── packages/
│   ├── db/             # Prisma schema, migrations, client
│   ├── core/           # deployment state machine, scheduler, quotas
│   ├── runtime/        # Docker runtime manager
│   ├── proxy/          # Traefik dynamic config integration
│   ├── github/         # OAuth, webhooks, repo access
│   └── shared/         # types, config, logging, errors
├── agent/              # C++ node agent (CMake, gRPC)
├── infra/
│   ├── compose/        # local docker-compose stack
│   ├── terraform/      # AWS EC2 single-node, then multi-node
│   └── observability/  # Prometheus, Grafana, Loki configs
├── docs/
│   ├── adr/            # architecture decision records
│   ├── api/            # API docs
│   └── benchmarks/     # measured, reproducible results
└── .github/workflows/  # lint, test, build, deploy
```

---

## Core modules

1. **Identity & multi-tenancy** – users, GitHub OAuth, orgs, roles (Owner / Admin / Developer / Viewer), API tokens, rate limiting. Authorization enforced server-side on every org-scoped resource.
2. **GitHub integration** – repo selection, webhook registration, signature verification, duplicate webhook detection, commit SHA tracking.
3. **Build engine** – clone, checkout SHA, detect app type, Dockerfile or generated default, build, validate, push to registry, stream logs. Untrusted code runs in restricted builders. Never expose the host Docker socket to builds.
4. **Async jobs** – BullMQ with priorities, bounded concurrency, retries with backoff, dead-letter, heartbeats, graceful shutdown, abandoned-job recovery, idempotency. Postgres is the source of truth; Redis is just the queue. Transactional outbox for event publishing.
5. **Deployment orchestrator** – persistent state machine (below), transactional transitions, versioning, traffic switch, rollback, cancellation, event history.
6. **Container runtime** – create / start / stop / inspect / health / logs / cleanup via Docker API. Non-root, dropped capabilities, seccomp, read-only FS, resource limits, no privileged containers.
7. **C++ infrastructure agent** – CPU, memory, disk, container stats, heartbeats, node registration over authenticated gRPC.
8. **Scheduler** – resource-aware bin-packing across nodes, reservations, draining, failure detection, rescheduling.
9. **Networking** – Traefik hostname routing, auto TLS, custom domains, health-aware routing, connection draining.
10. **Zero-downtime deploys** – start new, health check, register, switch, drain old, terminate old. Failed health check leaves the old version live.
11. **Rollback** – every LIVE deployment has an immutable image. Rollback reuses the image, never rebuilds.
12. **Observability** – Prometheus metrics, Grafana dashboards, Loki logs, OTel traces across the deployment workflow.
13. **Quotas** – per-org CPU, memory, concurrent builds, running apps, storage. Admission checks before scheduling.

### Deployment state machine

```
CREATED → QUEUED → BUILDING → BUILD_SUCCEEDED → SCHEDULING → DEPLOYING → HEALTH_CHECKING → LIVE

Terminal failure states: BUILD_FAILED, DEPLOY_FAILED, HEALTH_CHECK_FAILED, CANCELLED, SUPERSEDED
```

### Database entities

`users`, `organizations`, `memberships`, `projects`, `repositories`, `deployments`, `builds`, `runtime_instances`, `infrastructure_nodes`, `environment_variables`, `domains`, `deployment_events`, `usage_records`, `api_tokens`

Org-scoped tenancy, FK constraints, indexes, UTC timestamps, encrypted secrets, optimistic concurrency on deployments.

---

## Build plan

We build in phases. Each phase ships something runnable and tested before the next starts.

| Phase | Goal | Done when |
| ----- | ---- | --------- |
| 1 | Foundation | Monorepo, API, Prisma schema + migrations, auth, orgs, projects, Compose stack up |
| 2 | GitHub | OAuth, repo picker, verified webhooks, push creates a deployment record |
| 3 | Build engine | Queue + worker builds a Docker image from a repo, logs stream to dashboard, cancel + retry work |
| 4 | Orchestration | State machine persisted, container starts with limits + env, health checks gate LIVE |
| 5 | Networking | Traefik routes `<app>.forge.local`, HTTPS, custom domains |
| 6 | Reliability | Zero-downtime switch, rollback, worker crash recovery, duplicate job handling, graceful shutdown |
| 7 | C++ agent | Agent reports node metrics + heartbeats over gRPC, Control Plane shows node health |
| 8 | Observability | Prometheus, Grafana, Loki, OTel wired end to end |
| 9 | Multi-node | Scheduler places workloads across nodes, detects failures, reschedules |
| 10 | Hardening | Tenant isolation tests, secrets encryption, quotas, backups, load + failure-injection tests, CI/CD, docs |

### Infrastructure stages

- **Stage 1** – Local: Docker Compose with Postgres, Redis, workers, Traefik, observability stack.
- **Stage 2** – Single EC2 node via Terraform, public HTTPS, registry, backups, CI/CD.
- **Stage 3** – Multiple nodes, C++ agents, distributed scheduling.
- **Stage 4** – Optional Kubernetes backend, multi-region, canary, autoscaling. Only after Forge's own scheduler is proven.

---

## Failure scenarios we test for

- Build worker crashes mid-build.
- Duplicate GitHub webhooks and duplicate jobs.
- Redis or Postgres temporarily unavailable.
- App fails to start or goes unhealthy.
- Node unreachable.
- Container exceeds memory limit.
- New deployment fails during traffic switch.
- Control Plane restarts during an active deployment.

No accepted deployment request may be silently lost.

---

## Security principles

- Treat every repo and Dockerfile as untrusted input.
- Builds and apps run non-root, capability-restricted, resource-limited, network-isolated.
- Docker daemon is never reachable from customer workloads or the public internet.
- Env vars encrypted at rest, never logged.
- Webhook signatures verified; API rate limited; audit log on sensitive actions.
- Node agent speaks an authenticated, versioned interface and exposes no privileged ops.

---

## Engineering rules

1. Reliability over feature count.
2. Durable state in Postgres for anything that matters.
3. Idempotent async processing everywhere.
4. Clear module boundaries; extract services only when justified.
5. Measure performance (p50 / p95 / p99); never fabricate benchmarks.
6. Every major decision gets an ADR in `docs/adr/`.

---

## Getting started (Phase 1 target)

```bash
pnpm install
cp .env.example .env
docker compose -f infra/compose/docker-compose.yml up -d   # postgres, redis, traefik
pnpm db:migrate
pnpm dev                                                  # api + web + workers
```

Dashboard at `http://localhost:3000`, API at `http://localhost:4000`.

---

## Status

Phase 1 in progress. See `docs/adr/` for decisions and `docs/benchmarks/` for measured results as they land.
