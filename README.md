<div align="center">

# ⚒️ Forge

**The Infrastructure Layer for Shipping Software.**

*Ship code, not infrastructure. From `git push` to a live, production-grade URL.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![C++](https://img.shields.io/badge/C%2B%2B-20-00599C?logo=cplusplus&logoColor=white)](https://isocpp.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/Docker-Engine%20API-2496ED?logo=docker&logoColor=white)](https://www.docker.com)
[![Status](https://img.shields.io/badge/Status-Phase%201-orange)](#-roadmap)

</div>

---

Forge is a self-hosted, production-grade **Platform-as-a-Service** that turns a GitHub repository into a live HTTPS application. Connect a repo, pick a branch, set env vars, hit deploy. Forge builds the image, schedules it onto a node, runs it in an isolated container, routes traffic to it, and lets you roll back to any previous version in one click.

Inspired by Vercel, Render and Railway, but the point of this project is the infrastructure underneath: the build engine, the deployment state machine, the scheduler, the container runtime, and the reliability guarantees that hold it all together.

## 📑 Table of Contents

- [What it does](#-what-it-does)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Repository Layout](#-repository-layout)
- [Core Modules](#-core-modules)
- [Roadmap](#-roadmap)
- [Reliability](#-reliability)
- [Security](#-security)
- [Engineering Principles](#-engineering-principles)
- [Getting Started](#-getting-started)
- [License](#-license)

## ✨ What it does

| # | Capability |
|:-:|------------|
| 1 | Register, create an organization, invite members with roles |
| 2 | Connect a GitHub repository and select a branch |
| 3 | Configure encrypted environment variables |
| 4 | Trigger deployments manually or via push webhooks |
| 5 | Watch build logs stream in real time |
| 6 | Get a public HTTPS URL, or bring a custom domain |
| 7 | Monitor health, logs, CPU and memory from the dashboard |
| 8 | View deployment history and roll back to any healthy version |
| 9 | Run many apps across many infrastructure nodes |

## 🏗 Architecture

Forge is split into a **Control Plane** that decides and a **Data Plane** that executes.

```
                          ┌──────────────────┐
                          │    Developer     │
                          └────────┬─────────┘
                                   │
                          ┌────────▼─────────┐
                          │ Next.js Dashboard│
                          └────────┬─────────┘
                                   │
 ╔═════════════════════════════════▼═══════════════════════════════════╗
 ║  CONTROL PLANE                                                      ║
 ║                                                                     ║
 ║   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ║
 ║   │  Express API │─────▶│  PostgreSQL  │      │    Redis     │      ║
 ║   │  auth · orgs │      │  (metadata)  │      │   (BullMQ)   │      ║
 ║   │  github · … │      └──────────────┘      └──────┬───────┘      ║
 ║   └──────────────┘                                  │              ║
 ║                                              ┌──────▼───────┐      ║
 ║                                              │ Build Workers│      ║
 ║                                              └──────┬───────┘      ║
 ║                                                     │ image        ║
 ║                                              ┌──────▼───────┐      ║
 ║                                              │  Deployment  │      ║
 ║                                              │   Manager    │      ║
 ║                                              └──────┬───────┘      ║
 ║                                              ┌──────▼───────┐      ║
 ║                                              │  Scheduler   │      ║
 ║                                              └──────┬───────┘      ║
 ╚═════════════════════════════════════════════════════╪══════════════╝
                                                       │
 ╔═════════════════════════════════════════════════════╪══════════════╗
 ║  DATA PLANE                                         │              ║
 ║                                                     │              ║
 ║        ┌───────────────┬────────────────┬───────────┘              ║
 ║   ┌────▼────┐     ┌────▼────┐      ┌────▼────┐                     ║
 ║   │ Node 1  │     │ Node 2  │      │ Node 3  │   ◀── C++ agent     ║
 ║   │ [App A] │     │ [App B] │      │ [App C] │       on each node  ║
 ║   └────┬────┘     └────┬────┘      └────┬────┘                     ║
 ║        └───────────────┼────────────────┘                          ║
 ║                   ┌────▼────┐                                      ║
 ║                   │ Traefik │  hostname routing · auto TLS         ║
 ║                   └────┬────┘                                      ║
 ╚════════════════════════╪═══════════════════════════════════════════╝
                          │
                     ┌────▼────┐
                     │Internet │
                     └─────────┘
```

> **Control Plane** is a modular monolith plus independently deployable workers. No microservices until scale or isolation demands it.
>
> **Data Plane** runs customer containers and keeps serving traffic even if the Control Plane is down.
>
> Starts on a single Linux node. Designed from day one for multi-node.

## 🧰 Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js · React · TypeScript · Tailwind CSS |
| **Backend** | Node.js · TypeScript · Express 5 · REST · WebSockets |
| **Systems** | C++20 node agent, gRPC to the Control Plane |
| **Database** | PostgreSQL 16 · Prisma |
| **Queue** | Redis 7 · BullMQ |
| **Containers** | Docker Engine API · OCI images |
| **Proxy** | Traefik, hostname routing, automatic TLS |
| **Observability** | Prometheus · Grafana · Loki · OpenTelemetry |
| **Infra** | Docker Compose (dev) · AWS EC2 + Terraform (prod) |
| **Testing** | Vitest · Playwright · GoogleTest · k6 |
| **CI/CD** | GitHub Actions |

## 📂 Repository Layout

```
forge/
├── apps/
│   ├── web/              Next.js dashboard
│   └── api/              Express control plane API
├── workers/
│   ├── build/            BullMQ build worker
│   └── deploy/           BullMQ deployment worker
├── packages/
│   ├── db/               Prisma schema, migrations, client
│   ├── core/             deployment state machine, scheduler, quotas, outbox
│   ├── runtime/          Docker runtime manager
│   ├── proxy/            Traefik dynamic config integration
│   ├── github/           OAuth, webhooks, repo access
│   └── shared/           env config, errors, logging, types
├── agent/                C++ node agent (CMake, gRPC)
├── infra/
│   ├── compose/          local docker-compose stack
│   ├── terraform/        AWS EC2 single-node, then multi-node
│   └── observability/    Prometheus, Grafana, Loki, OTel configs
├── docs/
│   ├── adr/              architecture decision records
│   ├── guides/           step-by-step implementation guides
│   ├── api/              API reference
│   └── benchmarks/       measured, reproducible results
└── .github/workflows/    lint, test, build, deploy
```

## 🧩 Core Modules

<details>
<summary><b>1. Identity &amp; Multi-tenancy</b></summary>

Users, GitHub OAuth, organizations, roles (Owner / Admin / Developer / Viewer), API tokens, rate limiting. Authorization is enforced server-side on every org-scoped resource.
</details>

<details>
<summary><b>2. GitHub Integration</b></summary>

Repo selection, webhook registration, signature verification, duplicate webhook detection, immutable commit SHA tracking per deployment.
</details>

<details>
<summary><b>3. Build Engine</b></summary>

Clone, checkout SHA, detect app type, use the Dockerfile or generate a default, build, validate, push to registry, stream logs. Untrusted code runs in restricted builders. The host Docker socket is never exposed to builds.
</details>

<details>
<summary><b>4. Asynchronous Jobs</b></summary>

BullMQ with priorities, bounded concurrency, retries with exponential backoff, dead-letter queues, heartbeats, graceful shutdown, abandoned-job recovery and idempotency. PostgreSQL is the source of truth; Redis is only the queue. Transactional outbox for event publishing.
</details>

<details>
<summary><b>5. Deployment Orchestrator</b></summary>

Persistent state machine with transactional transitions, versioning, traffic switching, rollback, cancellation and a full event history.

```
CREATED → QUEUED → BUILDING → BUILD_SUCCEEDED → SCHEDULING → DEPLOYING → HEALTH_CHECKING → LIVE

Terminal:  BUILD_FAILED · DEPLOY_FAILED · HEALTH_CHECK_FAILED · CANCELLED · SUPERSEDED
```
</details>

<details>
<summary><b>6. Container Runtime</b></summary>

Create / start / stop / inspect / health / logs / cleanup via the Docker API. Non-root, dropped capabilities, seccomp, read-only filesystem, resource limits, no privileged containers.
</details>

<details>
<summary><b>7. C++ Infrastructure Agent</b></summary>

CPU, memory, disk and container stats, heartbeats, node registration over authenticated gRPC.
</details>

<details>
<summary><b>8. Distributed Scheduler</b></summary>

Resource-aware bin-packing across nodes, reservations, draining, failure detection, rescheduling.
</details>

<details>
<summary><b>9. Networking</b></summary>

Traefik hostname routing, automatic TLS, custom domains, health-aware routing, connection draining.
</details>

<details>
<summary><b>10. Zero-downtime Deploys</b></summary>

Start new → health check → register → switch traffic → drain old → terminate old. A failed health check leaves the previous version live.
</details>

<details>
<summary><b>11. Rollback &amp; Versioning</b></summary>

Every LIVE deployment has an immutable image. Rollback reuses that image, never rebuilds.
</details>

<details>
<summary><b>12. Observability</b></summary>

Prometheus metrics, Grafana dashboards, Loki logs, OpenTelemetry traces across the whole deployment workflow.
</details>

<details>
<summary><b>13. Resource Quotas</b></summary>

Per-org CPU, memory, concurrent builds, running apps and storage limits. Admission checks before scheduling.
</details>

### Database entities

`users` · `organizations` · `memberships` · `projects` · `repositories` · `deployments` · `builds` · `runtime_instances` · `infrastructure_nodes` · `environment_variables` · `domains` · `deployment_events` · `usage_records` · `api_tokens`

Org-scoped tenancy, FK constraints, indexes, UTC timestamps, encrypted secrets, optimistic concurrency on deployments.

## 🗺 Roadmap

Each phase ships something runnable and tested before the next starts.

| Phase | Goal | Done when | Status |
|:-----:|------|-----------|:------:|
| 1 | **Foundation** | Monorepo, API, Prisma schema + migrations, auth, orgs, projects, Compose stack | 🟡 In progress |
| 2 | **GitHub** | OAuth, repo picker, verified webhooks, push creates a deployment record | ⚪ |
| 3 | **Build engine** | Worker builds a Docker image from a repo, logs stream, cancel + retry | ⚪ |
| 4 | **Orchestration** | State machine persisted, container starts with limits, health checks gate LIVE | ⚪ |
| 5 | **Networking** | Traefik routes `<app>.forge.local`, HTTPS, custom domains | ⚪ |
| 6 | **Reliability** | Zero-downtime switch, rollback, worker crash recovery, duplicate job handling | ⚪ |
| 7 | **C++ agent** | Node metrics + heartbeats over gRPC, Control Plane shows node health | ⚪ |
| 8 | **Observability** | Prometheus, Grafana, Loki, OTel wired end to end | ⚪ |
| 9 | **Multi-node** | Scheduler places workloads across nodes, detects failures, reschedules | ⚪ |
| 10 | **Hardening** | Tenant isolation tests, secrets encryption, quotas, backups, load + chaos tests, CI/CD | ⚪ |

**Infrastructure stages:** Local Compose → Single EC2 node via Terraform → Multi-node with C++ agents → Optional Kubernetes backend, only after Forge's own scheduler is proven.

## 🛡 Reliability

Failure scenarios the test suite covers:

- Build worker crashes mid-build
- Duplicate GitHub webhooks and duplicate jobs
- Redis or PostgreSQL temporarily unavailable
- App fails to start or goes unhealthy
- Node becomes unreachable
- Container exceeds its memory limit
- New deployment fails during traffic switch
- Control Plane restarts during an active deployment

> No accepted deployment request may ever be silently lost.

## 🔒 Security

- Every repo and Dockerfile is treated as untrusted input.
- Builds and apps run non-root, capability-restricted, resource-limited and network-isolated.
- The Docker daemon is never reachable from customer workloads or the public internet.
- Environment variables are encrypted at rest and never logged.
- Webhook signatures are verified, the API is rate limited, sensitive actions are audit-logged.
- The node agent speaks an authenticated, versioned interface and exposes no privileged operations.

## 🧭 Engineering Principles

1. Reliability over feature count.
2. Durable state in PostgreSQL for anything that matters.
3. Idempotent async processing everywhere.
4. Clear module boundaries; extract services only when justified.
5. Measure performance (p50 / p95 / p99). Never fabricate benchmarks.
6. Every major decision gets an ADR in `docs/adr/`.

## 🚀 Getting Started

**Prerequisites:** Node 20+, pnpm 9, Docker.

```bash
git clone <repo-url> forge && cd forge
cp .env.example .env          # set SESSION_SECRET: openssl rand -hex 32
pnpm install
pnpm infra:up                 # postgres + redis
pnpm db:generate
pnpm db:migrate
pnpm dev                      # api on :4000
```

Verify:

```bash
curl localhost:4000/health
# {"status":"ok"}
```

Step-by-step implementation guides live in [`docs/guides/`](./docs/guides/).

## 📄 License

MIT. See [LICENSE](./LICENSE).

<div align="center">
<sub>Developers focus on building software. Forge handles the infrastructure required to build, deploy, operate, monitor and scale it.</sub>
</div>
