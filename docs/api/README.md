# Forge API Reference (Phase 1)

Base URL: `http://localhost:4000`. All responses are JSON. Errors are `{ "error": { "code", "message" } }`.

## Authentication

Two methods, checked in this order:

1. `Authorization: Bearer forge_...` API token.
2. `forge_session` httpOnly cookie, set by register and login.

API tokens cannot create other tokens.

## Roles

`VIEWER` < `DEVELOPER` < `ADMIN` < `OWNER`. Non-members receive **404** on org routes, never 403, so org slugs cannot be enumerated.

## Endpoints

### Auth

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/v1/auth/register` | none | `{ email, password, name? }` | 201 `{ user, org }` + cookie. Creates a personal org with the user as OWNER. |
| POST | `/v1/auth/login` | none | `{ email, password }` | 204 + cookie |
| POST | `/v1/auth/logout` | any | | 204 |
| GET | `/v1/auth/me` | any | | 200 `{ user, authMethod }` |

### Organizations

| Method | Path | Min role | Body | Response |
|---|---|---|---|---|
| GET | `/v1/orgs` | any user | | 200 `{ orgs: [{ ...org, role }] }` |
| POST | `/v1/orgs` | any user | `{ name }` | 201 `{ org }` |
| GET | `/v1/orgs/:orgSlug` | VIEWER | | 200 `{ org }` |
| PATCH | `/v1/orgs/:orgSlug` | ADMIN | `{ name? }` | 200 `{ org }` |
| DELETE | `/v1/orgs/:orgSlug` | OWNER | | 204 |
| GET | `/v1/orgs/:orgSlug/audit?limit=&before=` | ADMIN | | 200 `{ entries }` |

### Members

| Method | Path | Min role | Body | Rules |
|---|---|---|---|---|
| GET | `/v1/orgs/:orgSlug/members` | VIEWER | | |
| POST | `/v1/orgs/:orgSlug/members` | ADMIN | `{ email, role? }` | User must already exist. Cannot grant a role above your own. |
| PATCH | `/v1/orgs/:orgSlug/members/:userId` | ADMIN | `{ role }` | Cannot change own role. Cannot act on equal or higher role unless OWNER. Last OWNER cannot be demoted. |
| DELETE | `/v1/orgs/:orgSlug/members/:userId` | VIEWER (self) / ADMIN (others) | | Last OWNER cannot leave. |

### Projects

| Method | Path | Min role | Body |
|---|---|---|---|
| GET | `/v1/orgs/:orgSlug/projects` | VIEWER | |
| POST | `/v1/orgs/:orgSlug/projects` | DEVELOPER | `{ name, defaultBranch?, rootDirectory? }` |
| GET | `/v1/orgs/:orgSlug/projects/:projectSlug` | VIEWER | |
| PATCH | `/v1/orgs/:orgSlug/projects/:projectSlug` | DEVELOPER | `{ name?, defaultBranch?, rootDirectory? }` |
| DELETE | `/v1/orgs/:orgSlug/projects/:projectSlug` | ADMIN | |

`rootDirectory` must start with `/` and may not contain `..`. Slugs are unique per org.

### API tokens

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/v1/tokens` | any | | 200 `{ tokens }` (never includes the secret) |
| POST | `/v1/tokens` | session only | `{ name, expiresInDays? }` | 201 `{ token: { ...meta, token } }`. The secret is returned once. |
| DELETE | `/v1/tokens/:tokenId` | any | | 204 |

## Audit actions

`org.create` `org.update` `org.delete` `member.add` `member.role_change` `member.remove` `member.leave` `project.create` `project.update` `project.delete` `token.create` `token.revoke`

## Error codes

`VALIDATION_ERROR` 400 · `SELF_ROLE_CHANGE` 400 · `UNAUTHORIZED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `EMAIL_TAKEN` 409 · `ALREADY_MEMBER` 409 · `LAST_OWNER` 409 · `SLUG_EXHAUSTED` 409 · `INTERNAL_ERROR` 500
