# BACO — Native VM Deployment Runbook (no Docker)

Run the new system directly on a GCP VM as OS services — the same shape as the
old Grails VM. No Docker, no Kubernetes.

**Topology (single VM):**

```
                       :443 (TLS)
  Internet ── nginx ───────────────┬── /payment/  → 127.0.0.1:8000  (FastAPI, Pelecard callbacks)
                                    ├── /jobs/     → 127.0.0.1:8000  (FastAPI, Cloud Scheduler — optional)
                                    └── /          → 127.0.0.1:3000  (Next.js)
                                                         └─ /api/backend/* rewritten to 127.0.0.1:8000
  FastAPI ── mysqlclient ─→ MySQL 9.6 (127.0.0.1:3306)
```

Ready-to-use files live in [`deploy/`](../deploy): `baco-backend.service`,
`baco-frontend.service`, `nginx-baco.conf`.

---

## ⚠️ Read first: MySQL 8 (old) → MySQL 9.6 (new) changes the rollback model

The old system runs on **MySQL 8**; the new system will run on **MySQL 9.6**.
Two different engine versions means **two separate database servers** — they
cannot share one data directory. So the earlier "one shared DB, flip the proxy,
zero data loss" rollback does **not** apply here.

What this means concretely:

- You load a **dump of the MySQL-8 production data into the new MySQL 9.6**, then
  apply migrations 001–004.
- After cutover, new bookings/orders are written to **MySQL 9.6 only**. The old
  MySQL 8 is frozen and does not see them.
- **Rollback = switch traffic back to the old VM/MySQL 8**, which loses anything
  booked on the new system during the live window.

Mitigations (pick per your risk tolerance):
1. **Short, monitored window** at low-traffic time; roll back fast if needed so
   few/no bookings are lost, and re-enter any by hand.
2. **Dump-and-load at the last moment**: take the final MySQL-8 dump immediately
   before cutover and load it into 9.6, so 9.6 starts current.
3. Keep the old MySQL 8 **frozen/read-only** during the window so it stays a
   clean fallback.

> If instant, zero-loss rollback matters more than the version bump, the
> alternative is to run the new app against the **existing MySQL 8** (SQLAlchemy
> works fine with 8) — then old and new share one DB and rollback is just a proxy
> flip. Choose 9.6 only if the upgrade itself is a goal.

Dumping MySQL 8 → importing into 9.6 is normally clean; keep the charset/collation
and backslash handling from [`DB-Prod-Copy-Guide.md`](DB-Prod-Copy-Guide.md).

---

## 1. Provision the VM

A Debian/Ubuntu GCP VM (commands below assume `apt`). Create a service user and
a home for the app:

```bash
sudo adduser --system --group --home /opt/baco baco
sudo mkdir -p /opt/baco && sudo chown baco:baco /opt/baco
```

Install runtimes (adjust versions to match the repo — Python 3.12, Node 20+):

```bash
sudo apt update
sudo apt install -y python3.12 python3.12-venv nginx git
# Node.js 20 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**MySQL 9.6** — Debian/Ubuntu's own repos only carry 8.0/8.4, so add MySQL's
official APT repo (the "Innovation" channel gives the 9.x line). Skip if MySQL
runs on a remote host.

```bash
# Grab the current mysql-apt-config from https://dev.mysql.com/downloads/repo/apt/
# (the version in the filename changes over time).
cd /tmp
wget https://dev.mysql.com/get/mysql-apt-config_0.8.34-1_all.deb
sudo dpkg -i mysql-apt-config_0.8.34-1_all.deb
# In the dialog choose the "mysql-innovation" series (9.x); LTS = 8.4, default = 8.0.

sudo apt update
sudo apt install -y mysql-community-server
sudo systemctl enable --now mysql
sudo mysql_secure_installation
mysql --version                      # confirm 9.x
```

> The Innovation channel installs the latest 9.x available (may be 9.6 or newer).
> To pin exactly 9.6, install the versioned packages and `apt-mark hold` them.

Set the VM timezone (the scheduler pins Asia/Jerusalem, but keep the host aligned):

```bash
sudo timedatectl set-timezone Asia/Jerusalem
```

## 2. Get the code

```bash
sudo -u baco git clone <your-repo-url> /opt/baco/app
# (or clone elsewhere and point the unit files' paths accordingly)
```

The unit files assume `/opt/baco/backend` and `/opt/baco/frontend`. Either clone
so those resolve, or edit the paths in the `deploy/*.service` files.

## 3. Database (MySQL 9.6)

Create the DB and a least-privilege app user, then load production data:

```bash
sudo mysql -e "CREATE DATABASE baco CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'baco'@'localhost' IDENTIFIED BY '<STRONG_PASSWORD>';"
sudo mysql -e "GRANT ALL PRIVILEGES ON baco.* TO 'baco'@'localhost'; FLUSH PRIVILEGES;"

# Load the production dump (taken from MySQL 8 — see DB-Prod-Copy-Guide.md for the
# mysqldump flags and the charset/backslash pre-processing), then migrations:
mysql -u baco -p baco < ~/baco_prod_dump.sql
for f in /opt/baco/backend/migrations/0*.sql; do echo "-- $f"; mysql -u baco -p baco < "$f"; done
```

## 4. Backend (FastAPI)

```bash
cd /opt/baco/backend
sudo -u baco python3.12 -m venv .venv
sudo -u baco .venv/bin/pip install -r requirements.txt
```

Create `/opt/baco/backend/.env` (owned by `baco`, `chmod 600`) — from
`.env.example`, with production values:

```
DATABASE_URL=mysql+pymysql://baco:<STRONG_PASSWORD>@127.0.0.1:3306/baco?charset=utf8mb4
JWT_SECRET=<long random string>
DEV_MODE=false                      # real Pelecard charges
APP_BASE_URL=https://baco.co.il     # used to build Pelecard callback URLs
FRONTEND_BASE_URL=https://baco.co.il
# Pelecard PROD terminal creds:
PELECARD_GATEWAY_URL=https://gateway.pelecard.biz/Iframe
PELECARD_MATNASIM_TERM=...
PELECARD_MATNASIM_PASSWORD=...
# ... other clubs' terminals as needed
# Mailgun (do NOT reset the prod SMTP password):
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
EMAIL_FROM=servicebaco@gmail.com
# SMS (019), Anthropic:
SMS_USERNAME=...
SMS_PASSWORD=...
ANTHROPIC_API_KEY=...
# Scheduler — choose ONE model (see step 8):
ENABLE_SCHEDULER=true               # in-process; single instance only
SCHEDULER_TOKEN=                    # set only if using Cloud Scheduler
```

Smoke-test manually before wiring systemd:

```bash
cd /opt/baco/backend && .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
curl -s localhost:8000/health   # {"status":"ok"}
```

## 5. Frontend (Next.js)

```bash
cd /opt/baco/frontend
sudo -u baco npm ci
sudo -u baco npm run build
```

Create `/opt/baco/frontend/.env.production` (git-ignored by `.env.*`):

```
BACKEND_URL=http://127.0.0.1:8000
ANTHROPIC_API_KEY=...
ANTHROPIC_WORKSPACE_ID=...          # if the key is identity-linked
```

Test:

```bash
cd /opt/baco/frontend && PORT=3000 npm run start
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000    # 200
```

## 6. systemd services

```bash
sudo cp /opt/baco/deploy/baco-backend.service  /etc/systemd/system/
sudo cp /opt/baco/deploy/baco-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now baco-backend baco-frontend
sudo systemctl status baco-backend baco-frontend
journalctl -u baco-backend -f     # tail logs
```

Both restart on crash/reboot. The backend runs a **single instance** (no
`--workers`) so the in-process scheduler fires once.

## 7. nginx + TLS

```bash
sudo cp /opt/baco/deploy/nginx-baco.conf /etc/nginx/sites-available/baco.conf
sudo ln -s /etc/nginx/sites-available/baco.conf /etc/nginx/sites-enabled/baco.conf
sudo rm -f /etc/nginx/sites-enabled/default

# TLS via Let's Encrypt (or install your own cert at the paths in the conf):
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d baco.co.il -d www.baco.co.il

sudo nginx -t && sudo systemctl reload nginx
```

The conf routes `/payment/` and `/jobs/` to FastAPI and everything else to
Next.js (which proxies `/api/backend/*` to FastAPI itself).

## 8. Background jobs — pick one model

See [`Background-Jobs-Deployment.md`](Background-Jobs-Deployment.md). On a single
always-on VM the simplest is **in-process**: `ENABLE_SCHEDULER=true` (already in
`.env`), nothing else to do. If you prefer Cloud Scheduler, set
`ENABLE_SCHEDULER=false` + a `SCHEDULER_TOKEN` and create the two Cloud Scheduler
jobs against `https://baco.co.il/jobs/rebuild` and `/jobs/release-orders`.
**Never both** — and disable the OLD system's cron at cutover.

## 9. Production smoke test

Log in; search; make **one real booking** and **one small real ticket purchase**
(verify the Pelecard callback lands and the order/ticket finalizes); cancel a
booking (credit + email); check manager screens (orders, receipts, permissions,
schedule, holidays); confirm confirmation **emails/SMS** send; open the chat.

---

## Deploy / update procedure (subsequent releases)

```bash
cd /opt/baco/app && sudo -u baco git pull
# backend deps if changed:
cd /opt/baco/backend && sudo -u baco .venv/bin/pip install -r requirements.txt
# apply any NEW migrations:
for f in migrations/0*.sql; do mysql -u baco -p baco < "$f"; done
# frontend rebuild:
cd /opt/baco/frontend && sudo -u baco npm ci && sudo -u baco npm run build
# restart:
sudo systemctl restart baco-backend baco-frontend
```

(The backend has no hot-reload, so a restart is required after backend changes.)

---

## Cutover & rollback

**Switch point:** keep a reverse proxy / GCP HTTPS Load Balancer (or DNS with a
low TTL) that points `baco.co.il` at either the **old VM** or the **new VM**.

**Cutover (low-traffic window):**
1. Final MySQL-8 dump → load into MySQL 9.6 (so it starts current); re-apply
   migrations 001–004.
2. Freeze the old system (maintenance page / stop old app) so no new writes go to
   MySQL 8.
3. Point the switch at the new VM.
4. Disable the old cron; ensure exactly one scheduler runs (step 8).
5. Run the step-9 smoke test, including one real payment.

**Rollback (if it fails):**
1. Point the switch back at the old VM (old MySQL 8, old app, old cron).
2. Re-enter by hand any bookings made on the new system during the window (they
   live in MySQL 9.6, not MySQL 8) — this is the data-loss cost of the version
   split; keeping the window short minimises it.

Keep the old VM (stopped but intact), a VM/disk snapshot, and the pre-cutover
dumps for a defined grace period (e.g. 2 weeks) before decommissioning.

---

## Gotchas checklist

- `DATABASE_URL` → the real MySQL 9.6 on `127.0.0.1` (native, so `localhost` is
  correct here — unlike the Docker case).
- `DEV_MODE=false` in production (otherwise payments are bypassed).
- `APP_BASE_URL` / `FRONTEND_BASE_URL` = `https://baco.co.il` so Pelecard
  callbacks are built correctly and reach `/payment/*` via nginx.
- **TLS required** — Pelecard, the PWA install, and cookies all need HTTPS.
- **Single backend instance** (no `--workers`, one VM) if using the in-process
  scheduler; otherwise jobs double-run.
- Don't reset the **Mailgun** production SMTP password.
- CORS in `backend/app/main.py` is `http://localhost:3000`; behind this
  single-origin proxy it's moot (same origin), but review it if you ever split
  origins.
