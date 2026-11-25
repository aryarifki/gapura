# Build a clean Gapura installation

This guide builds the application from this repository without importing the
running installation's database, drafts, media, API keys, Meta connection,
Telegram credentials, or private runtime configuration. The checked-in source,
default editorial configuration, skills, design tokens, fonts, schema, and
ordered migrations provide the application baseline.

## Requirements

- Debian 13 (or a compatible Linux host), Node.js **24.x**, npm, Python **3.10+**.
- PostgreSQL 17 with `uuid-ossp` and `pg_trgm` extensions available.
- `python3-venv`, `build-essential`, and the PostgreSQL client. `pdftotext` is
  optional; without it, official-PDF legal enrichment returns a bounded
  unavailable result and the rest of research continues.
- Network access for `npm ci` and pip. AI research/generation additionally needs
  provider credentials; public web/news search uses an optional Firecrawl key.

The checked-in font files and renderer tokens are already in `design-system/`.
The package install pins each service's npm dependency tree through its lockfile;
`sharp` downloads a platform-specific native package during installation.

## Install application dependencies

```bash
git clone https://github.com/aryarifki/gapura.git
cd gapura
bash scripts/bootstrap.sh
```

The bootstrap verifies Node major 24 and Python 3.10+, runs `npm ci` for every
service package (including API services that historically lacked lockfiles),
creates `.venv-editorial/`, and installs the pinned editorial Python packages.
It does not create a database, edit systemd, start services, or enable timers.

Copy `.env.example` to `.env`; replace placeholders and use absolute local paths
for `STORAGE_PATH`, `DESIGN_SYSTEM_PATH`, `EDITORIAL_PYTHON`, and private secret
files. Create the selected storage/private directories and make them writable by
the account that will run Gapura. Set permissions before entering credentials:

```bash
umask 077
cp .env.example .env
chmod 600 .env
```

Keep `.env` and provider-secret JSON outside Git. A local provider-secret file
must be JSON object data, owned by the service operator, mode `0600`; the
application creates it through its secret-store API. Configure database
credentials and two independent random values for `GAPURA_ADMIN_TOKEN` and
`RENDER_SECRET`. `GAPURA_ADMIN_TOKEN` signs private media URLs; it is not a
dashboard login credential.

## Create an empty database and apply schema

Create a dedicated database/user using a PostgreSQL administrator. Do not point
the initializer at a populated database: its schema seeds default sources and
settings, and this procedure is only for a new installation.

```sql
CREATE ROLE gapura_dev LOGIN PASSWORD 'REPLACE_WITH_A_UNIQUE_PASSWORD';
CREATE DATABASE gapura_dev OWNER gapura_dev;
```

Set `HME_DB_NAME=gapura_dev`, the matching connection fields, and
`GAPURA_DB_ALLOW_INIT=yes` in the private `.env`, then run:

```bash
bash scripts/init-database.sh
```

The initializer refuses database names not prefixed `gapura_`, checks the
explicit opt-in, and refuses a database that already contains public tables. It
applies `database/schema.sql` followed by the dated migrations in deterministic
order. In particular, publication targets are created before the additive
target-revision migration. The SQL files use idempotent DDL where applicable and
seed only default configuration; no editorial records are imported. If
initialization stops partway, inspect the error and recreate that dedicated empty
database before starting over; this initializer is not an upgrade tool for an
existing installation. Remove `GAPURA_DB_ALLOW_INIT` or set it to `no` after
initialization.

## Run locally

Use two terminals from the repository root:

```bash
cd services/render && node server.js
```

```bash
cd services/web && node server.js
```

Open `http://127.0.0.1:3005`. These foreground commands do not enable intake,
background Studio workers, Telegram delivery, or the publisher. Keep
`GAPURA_DISABLE_WORKERS=true`, `GAPURA_ENABLE_DELIVERY=false`, and
`META_PUBLISH_MODE=shadow` during initial setup. Scheduler timers are optional
operator-managed systemd units; the tracked `deploy/` units use the production
layout `/root/gapura` and `/etc/gapura/runtime.env`, so adapt their paths and
environment-file locations before installing them elsewhere. Leave both timers
disabled during setup; in the current production deployment they stay disabled
by design (see below).

Optional adjacent integrations are not application data and are not bundled:
n8n, Cloudflare Tunnel, public DNS/domain, Meta app/permissions/account tokens,
Telegram bot, X API, Firecrawl, and a private legal-index service. Without these,
the dashboard/rendering and configured local workflows still run, but their
specific external capabilities will be unavailable or use documented fallbacks.

## Current production topology (reference, updated 2026-11-25)

The running production deployment (host `deb-arya`) deliberately runs only:

- `hme-web.service` — dashboard, API, Claude Intake endpoint, and the
  publish-now worker (127.0.0.1:3005, public via Cloudflare Tunnel at
  `gapura.avenia.my.id`).
- `hme-render.service` — the Satori + Sharp render microservice
  (127.0.0.1:3000).
- PostgreSQL 17 and the `cloudflared` tunnel connector.

Since **2026-11-24** content production is centralized on **Muse** as the
sole newsroom (topic scanning, analysis, composition, and publishing via
Claude Intake; four automated daily editions plus owner-driven drafts).
The internal pipeline timers `gapura-pipeline.timer` and
`gapura-publisher.timer` are **disabled** by owner decision; their unit
files are kept and the change is reversible with
`systemctl enable --now <timer>`. Publishing to Meta is live through the
publish-now endpoint in `hme-web`, not through the timer-driven publisher.

**Tunnel operational note:** the Cloudflare Tunnel egress from this host
suffered recurring disruption during November 2026, diagnosed as upstream
SNI filtering of `h2.cftunnel.com` (TLS handshake failures toward the
Cloudflare edge on port 7844, while other SNI values pass on the same
edge). In practice the connection **flaps** — the public API alternates
between healthy and 503/1033 — and a watchdog on the host restarts
`cloudflared` automatically, with a cooldown after repeated failures.
This is an expected, self-healing condition, **not** a permanently fixed
one; treat short 503 windows as known behaviour and check the watchdog
before changing application services.

## Verify

```bash
bash scripts/test.sh
```

This runs unit/component tests without production services or provider keys.
On a Debian test host with PostgreSQL 17 and `runuser`, the isolated server and
database integration suites are also available:

```bash
bash scripts/test.sh --integration
```

That mode creates and drops a temporary database/role named `gapura_test_*` and
starts only isolated test fixtures. It does not use the configured application
database. Chromium browser tests are optional and skipped unless their browser
dependencies are explicitly configured.

## What “same application” means

The repository recreates application code, UI, rendering, default agent/provider
configuration, editorial skills, default database schema/seeds, and migrations.
It deliberately does **not** recreate the production dataset, generated drafts,
uploads, generated media, schedules, audit history, database IDs, provider keys,
Meta tokens/connection, Telegram credentials, private source settings, or
network/domain setup. Those must be provisioned separately by the new operator.
The R7 sign-off files in `storage/` are review records only; they are not runtime
fixtures and are not needed for a clean application install.
