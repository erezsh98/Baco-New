# BACO / TennisLine — Production Setup Guide (Debian VM)

Running the full site as a **long-lived service** on a GCP Debian VM: MySQL 8.4,
the FastAPI backend (uvicorn under systemd), and the Next.js frontend (built +
`next start` under systemd), all behind **nginx + HTTPS**. This is the production
counterpart of `BACO-Local-Setup-Guide.pdf` (which runs it by hand on a laptop).

- The GitHub repo has the **code**. You must also provide the **database** (data is
  not in git) and the **`.env` files** (git-ignored).
- Infra provisioning (VM, static IP, firewall, DNS) is in
  [`GCP-Setup-Guide.md`](GCP-Setup-Guide.md); deeper deployment/rollback notes are
  in [`Native-VM-Runbook.md`](Native-VM-Runbook.md). This guide is the hands-on
  "bring backend + frontend up as services" walkthrough.

**Concrete paths used below** match a repo cloned at
`/home/servicebaco/Baco-New` running as user **`servicebaco`**. If you used the
runbook's canonical layout (`/opt/baco`, user `baco`) instead, adjust the paths
and `User=` lines accordingly.

**Key difference from local:** production runs `DEV_MODE=false` (real Pelecard),
binds backend to `127.0.0.1:8000` and frontend to `127.0.0.1:3000` (never public),
and puts nginx + Let's Encrypt in front on 80/443.

---

## 1. Install prerequisites (on the VM)
Over SSH into the VM (see [`GCP-Setup-Guide.md`](GCP-Setup-Guide.md) for creating it):
- **Git** — `sudo apt install -y git`
- **Python 3.12** + venv — `sudo apt install -y python3 python3-venv python3-pip`
  (Debian's binary is `python3`, not `python`.)
- **Node.js 20 LTS** (Next.js 15 needs Node ≥ 18.18) — via NodeSource:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
  ```
- **MySQL 8.4 LTS** — via the MySQL APT repo (`mysql-apt-config`, choose the
  `mysql-8.4-lts` series). On **Debian 13 (trixie)** the installer isn't listed
  yet: pick **debian bookworm** in its dialog, and if the server package fails on
  `libaio1`, install Bookworm's `libaio1` `.deb` first. Full detail in
  [`Native-VM-Runbook.md`](Native-VM-Runbook.md) §1.
- **nginx** — `sudo apt install -y nginx`
- **certbot** — `sudo apt install -y certbot python3-certbot-nginx`

## 2. Get the code
```bash
cd /home/servicebaco
git clone https://github.com/erezsh98/Baco-New.git
cd Baco-New
```

## 3. Database (MySQL 8.4 on the VM)
The app needs the `play_tennis` DB. Copy the production dump over (see
[`DB-Prod-Copy-Guide.md`](DB-Prod-Copy-Guide.md) for the exact `mysqldump` flags
and charset pre-processing), then load it:
```bash
# create the DB
sudo mysql -e "CREATE DATABASE IF NOT EXISTS play_tennis \
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# import the dump you transferred to the VM
sudo mysql --default-character-set=utf8mb4 play_tennis < play_tennis.sql

# apply schema migrations (adds audit_log, new columns). Run once.
sudo mysql play_tennis < backend/migrations/001_modernization_schema.sql
```
Create a **dedicated app DB user** (don't run the app as root):
```sql
-- in `sudo mysql`
CREATE USER 'baco_app'@'127.0.0.1' IDENTIFIED BY 'a-strong-db-password';
GRANT SELECT, INSERT, UPDATE, DELETE ON play_tennis.* TO 'baco_app'@'127.0.0.1';
FLUSH PRIVILEGES;
```
> MySQL stays bound to `127.0.0.1` only — never open port 3306 in the firewall.
> To browse it from your laptop, tunnel over SSH (DBeaver → SSH tab).

## 4. Backend (FastAPI + uvicorn under systemd)
Create the venv and install deps:
```bash
cd /home/servicebaco/Baco-New/backend
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
```
Create **`backend/.env`** (copy the template and fill real values — it's git-ignored):
```bash
cp .env.example .env
nano .env
```
Production essentials (see `.env.example` for the full list):
```env
DATABASE_URL=mysql+pymysql://baco_app:a-strong-db-password@127.0.0.1/play_tennis
JWT_SECRET=<a long random string>
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440

# REAL payment gateway (not the dev bypass):
DEV_MODE=false
PELECARD_GATEWAY_URL=https://gateway.pelecard.biz/Iframe
# per-club terminal creds by u_name, e.g.:
PELECARD_MATNASIM_TERM=<terminal>
PELECARD_MATNASIM_PASSWORD=<password>

# where Pelecard redirects/callbacks land — the PUBLIC site:
APP_BASE_URL=https://baco.co.il
FRONTEND_BASE_URL=https://baco.co.il

# Mailgun SMTP (the prod mail provider — do NOT reset this password):
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@<your-mailgun-domain>
SMTP_PASSWORD=<mailgun domain SMTP password>
EMAIL_FROM=<from address on the verified domain>

# Background scheduler — pick ONE model (see §8):
ENABLE_SCHEDULER=true
```
Install the backend service (paths already filled for this layout):
```bash
sudo tee /etc/systemd/system/baco-backend.service > /dev/null <<'EOF'
[Unit]
Description=BACO backend (FastAPI / uvicorn)
After=network-online.target mysql.service
Wants=network-online.target

[Service]
Type=simple
User=servicebaco
Group=servicebaco
WorkingDirectory=/home/servicebaco/Baco-New/backend
ExecStart=/home/servicebaco/Baco-New/backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
Environment=TZ=Asia/Jerusalem
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now baco-backend
sudo systemctl status baco-backend
```
> Single instance, **no `--workers`** — the in-process scheduler must run exactly
> once. Logs: `sudo journalctl -u baco-backend -f`.

## 5. Frontend (Next.js — build, then `next start` under systemd)
Install deps and **build** (production serves the prebuilt `.next`, not `dev`):
```bash
cd /home/servicebaco/Baco-New/frontend
npm install
npm run build
```
Create **`frontend/.env.production`** (git-ignored; Next loads it for `next start`):
```env
# talks to the backend over localhost:
BACKEND_URL=http://127.0.0.1:8000

# AI chat runs in the frontend (server side). Keep the key SERVER-side —
# never prefix it NEXT_PUBLIC_ (that would ship it to the browser):
ANTHROPIC_API_KEY=<key>
ANTHROPIC_WORKSPACE_ID=<workspace id>
```
Install the frontend service:
```bash
sudo tee /etc/systemd/system/baco-frontend.service > /dev/null <<'EOF'
[Unit]
Description=BACO frontend (Next.js)
After=network-online.target baco-backend.service
Wants=network-online.target

[Service]
Type=simple
User=servicebaco
Group=servicebaco
WorkingDirectory=/home/servicebaco/Baco-New/frontend
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=TZ=Asia/Jerusalem
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now baco-frontend
sudo systemctl status baco-frontend
```
> Verify npm's path first with `which npm` (NodeSource installs `/usr/bin/npm`);
> if it differs, fix the `ExecStart` path. Logs: `sudo journalctl -u baco-frontend -f`.

## 6. nginx reverse proxy + HTTPS
The repo ships the server block at [`deploy/nginx-baco.conf`](../deploy/nginx-baco.conf).
Install and enable it:
```bash
sudo cp /home/servicebaco/Baco-New/deploy/nginx-baco.conf /etc/nginx/sites-available/baco.conf
sudo ln -s /etc/nginx/sites-available/baco.conf /etc/nginx/sites-enabled/baco.conf
sudo rm -f /etc/nginx/sites-enabled/default   # drop the welcome page
sudo nginx -t
sudo systemctl reload nginx
```
Issue the TLS certificate (needs **DNS pointing at the VM** and **port 80 open**):
```bash
sudo certbot --nginx -d baco.co.il -d www.baco.co.il
sudo certbot renew --dry-run   # confirm auto-renewal works
```
What the proxy does (already in the conf): 80 → 301 to 443; `/payment/*` and
`/jobs/*` → FastAPI `:8000` directly (Pelecard callbacks & external scheduler);
everything else → Next.js `:3000`. The browser's `/api/backend/*` calls are
rewritten to the backend by Next itself (via `BACKEND_URL`), so no extra nginx
rule is needed.

## 7. Super-admin (one-time per environment)
If you imported the prod dump, the super-admin already exists — skip this. For a
fresh DB, grant the single super-user:
```bash
cd /home/servicebaco/Baco-New/backend
.venv/bin/python set_super_admin.py your@email.com
```

## 8. Background jobs — pick one model
The slot-rebuild / cleanup jobs run **either** in-process (`ENABLE_SCHEDULER=true`,
simplest for a single VM) **or** driven externally by Cloud Scheduler hitting
`/jobs/*`. Details and trade-offs in
[`Background-Jobs-Deployment.md`](Background-Jobs-Deployment.md). For one VM, the
in-process model is fine — that's why the backend runs as a single instance.

## 9. Production smoke test
```bash
# services up?
sudo systemctl is-active baco-backend baco-frontend nginx mysql
# backend answers locally?
curl -s http://127.0.0.1:8000/health
# site answers over HTTPS?
curl -sI https://baco.co.il | head -1
```
Then in a browser: open `https://baco.co.il`, log in, search a court, and (with real
Pelecard creds) complete a booking end-to-end.

## 10. Deploy / update procedure (subsequent releases)
```bash
cd /home/servicebaco/Baco-New
git pull

# backend deps if requirements changed:
backend/.venv/bin/python -m pip install -r backend/requirements.txt
# apply any NEW migrations:
sudo mysql play_tennis < backend/migrations/00X_whatever.sql

# frontend rebuild (always, if frontend changed):
cd frontend && npm install && npm run build && cd ..

# restart both services:
sudo systemctl restart baco-backend baco-frontend
```

## 11. Quick gotchas
- **Two services** must be up: backend `:8000` and frontend `:3000`, both behind nginx.
- **`.env` files are per-machine and git-ignored** — recreate on the VM, never commit.
  Backend needs `backend/.env`; frontend needs `frontend/.env.production`.
- **`DEV_MODE=false`** in production — real Pelecard. `APP_BASE_URL`/`FRONTEND_BASE_URL`
  must be the public `https://baco.co.il` (that's where Pelecard redirects).
- **Never expose `ANTHROPIC_API_KEY` as `NEXT_PUBLIC_`** — keep it server-side.
- **Never open 3306 / 8000 / 3000** in the firewall — only 80/443 (and SSH). MySQL
  and both app servers bind to `127.0.0.1`.
- **Frontend must be `npm run build`'d** before `next start` — `dev` is not for prod.
- **Rebuild during an order:** the rebuild runs on its own DB session so it survives
  a client disconnect; still prefer running it off-peak.
- If MySQL was slow to start, the backend `Restart=always` + `After=mysql.service`
  will bring it up once the DB is ready — check `journalctl` if a service flaps.
