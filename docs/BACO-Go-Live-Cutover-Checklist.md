# BACO / TennisLine — Go-Live Cutover Checklist

The single, ordered, copy-paste runbook for taking the new GCP VM live at
`baco.co.il`, migrating off the old site with minimal downtime. Every step has the
exact commands.

**Assumptions used in the commands** (adjust if yours differ):
- New VM user **`servicebaco`**, repo at **`/home/servicebaco/Baco-New`**
- Production DB name **`play_tennis`**, app DB user **`baco_app`**
- Domain **`baco.co.il`** (+ `www`), registrar/DNS at **box.co.il**
- Region **me-west1**

**Structure:** **Part A** is prep you can do *ahead of time* with **zero impact on
the live old site**. **Part B** is the short cutover window. **Part C** verifies.
**Part D** is rollback. Read Part B fully before starting it.

---

## Legend
- 🖥️ **VM** = run in the new VM's SSH shell
- 💻 **laptop** = run on your machine
- 🌐 **Console** = Google Cloud Console (browser)
- 🏢 **box.co.il** = your domain registrar's DNS panel

---

# PART A — Prepare the new VM (no impact on the live site)

Do all of Part A days or hours before cutover. None of it touches `baco.co.il`
DNS, so the old site keeps serving normally.

## A1. 🖥️ Ship the final production code
Bring the VM to the exact commit you'll go live on.
```bash
cd /home/servicebaco/Baco-New
git fetch origin
git checkout main
git pull
git log --oneline -3          # confirm you have the latest (incl. the Next.js 15.5.26 bump)
```
> **Prerequisite:** the **Next.js 15.0.0 → 15.5.26 security bump** must already be
> committed on `main` before this pull. If it isn't done yet, do it in the repo
> first (bump `next` + `eslint-config-next` in `frontend/package.json`,
> `npm install`, `npm run build`, commit, push), then pull here.

## A2. 🌐 Reserve a static external IP and attach it to the VM
Production needs a permanent IP so DNS can point at it and never break on reboot.
1. **☰ → VPC network → IP addresses → Reserve external static address**
   - Name: `baco-ip` · Type: **Regional** · Region: **me-west1** · **Reserve**
2. **Attach it to the VM:** **☰ → Compute Engine → VM instances → `baco-vm` → Edit
   → Network interfaces → nic0 → External IPv4 address → select `baco-ip` → Done → Save.**
3. 🖥️ Confirm the VM now reports that IP:
   ```bash
   curl -s ifconfig.me; echo
   ```
   **Write this IP down** — it's the value for the DNS A record in Part B.

## A3. 🏢 Lower the DNS TTL on the current record (speeds up the flip)
In box.co.il's DNS panel, find the existing `A` record for `baco.co.il` (and
`www`) that points at the **old** server, and change its **TTL to 300 seconds**
(5 min). Do **not** change the IP yet. This makes the later cutover propagate in
minutes instead of hours. Do this at least one old-TTL period before cutover.

## A4. 🖥️ Install / confirm all prerequisites on the VM
```bash
# system packages
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip nginx certbot python3-certbot-nginx
node -v && npm -v            # Node 20 LTS present?
mysql --version              # MySQL 8.4 present?
```
If Node or MySQL are missing, install per [`Native-VM-Runbook.md`](Native-VM-Runbook.md) §1.

## A5. 🖥️ Backend venv + dependencies
```bash
cd /home/servicebaco/Baco-New/backend
python3 -m venv .venv                       # no-op if it already exists
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
```

## A6. 🖥️ Frontend dependencies + production build
```bash
cd /home/servicebaco/Baco-New/frontend
npm install
npm run build                               # must succeed; serves the prebuilt .next
```
If the build fails on a type error, fix it in the repo, push, pull, rebuild.

## A7. 🖥️ (Recommended) Pre-issue the TLS certificate with DNS-01 — zero downtime
This gets a valid cert for `baco.co.il` on the new VM **while the old site is still
live**, so at flip time HTTPS is instantly ready. Skip this only if you're copying
a paid cert (see A8) or accept a few seconds of "no HTTPS" at flip (Part B, B7 option 3).

```bash
sudo certbot certonly --manual --preferred-challenges dns \
  -d baco.co.il -d www.baco.co.il
```
Certbot prints one or two **TXT records** like:
```
_acme-challenge.baco.co.il  →  "abc123...def"
```
🏢 In box.co.il, add each as a **TXT record** (host `_acme-challenge`, value the
quoted string), wait ~1–2 min, then press Enter in certbot. On success the cert is
saved at:
```
/etc/letsencrypt/live/baco.co.il/fullchain.pem
/etc/letsencrypt/live/baco.co.il/privkey.pem
```
> These are the paths the shipped nginx conf already references, so Part B's nginx
> swap will "just work". You can delete the temporary `_acme-challenge` TXT records
> after issuance. (After the DNS flip, switch renewals to automatic — see C6.)

## A8. 🖥️ ALTERNATIVE to A7 — reuse the old paid cert (only if it's a paid CA cert)
Skip if you did A7. A cert is valid for the domain on any server, so you can copy it.
1. 💻/old server: copy the cert chain + private key off the **old** VM (paths vary;
   for a certbot old server they're under `/etc/letsencrypt/live/baco.co.il/`).
2. 🖥️ Put them on the new VM, e.g.:
   ```bash
   sudo mkdir -p /etc/ssl/baco
   sudo cp fullchain.pem /etc/ssl/baco/fullchain.pem
   sudo cp privkey.pem   /etc/ssl/baco/privkey.pem
   sudo chmod 600 /etc/ssl/baco/privkey.pem
   ```
3. In Part B's nginx step, point `ssl_certificate` / `ssl_certificate_key` at those
   two paths instead of the Let's Encrypt ones.
> **Recommendation:** unless this is a paid cert with real remaining validity,
> prefer A7 (fresh Let's Encrypt) — it auto-renews and needs no manual tracking.

---

# PART B — Cutover window (short; the site briefly transitions)

Do these in order, ideally at a low-traffic time. Steps B1–B6 can be finished
before the DNS flip (B7); the flip is the moment users move to the new site.

## B1. 🏢 (Optional but recommended) Freeze new bookings on the old site
Any booking made on the **old** site *after* you take the dump (B2) will not exist
in the new DB. To avoid losing data, put the old site into a brief maintenance
state (or accept a short freeze window and take the dump last-minute). Even a
simple "site under maintenance" note on the old site during the ~15–30 min cutover
prevents split data.

## B2. 💻 Take a FRESH production dump
On your laptop (Git Bash), pull the current production data. Replace the
placeholders with the values from Toad (see [`DB-Prod-Copy-Guide.md`](DB-Prod-Copy-Guide.md) §0):
```bash
mysqldump -h <GCP_HOST> -P 3306 -u <GCP_USER> -p \
  --single-transaction --routines --triggers --events --no-tablespaces \
  --set-gtid-purged=OFF --default-character-set=utf8mb4 \
  play_tennis > ~/baco_prod_dump.sql
ls -lh ~/baco_prod_dump.sql          # confirm it has real size
```
- If your export is the **Toad per-table** kind (many `.sql` files), merge them and
  **run the required backslash fix** — see [`DB-Prod-Copy-Guide.md`](DB-Prod-Copy-Guide.md)
  §1b — or `user_role`/`users_cart` will silently drop.
- If import later errors on **DEFINER/SUPER**, strip DEFINER clauses:
  ```bash
  sed -E 's/DEFINER=`[^`]+`@`[^`]+`//g' ~/baco_prod_dump.sql > ~/baco_prod_dump_clean.sql
  ```

## B3. 💻→🖥️ Copy the dump to the VM
Use the browser SSH **⚙ → Upload file**, or scp with your key:
```bash
gcloud compute scp ~/baco_prod_dump.sql baco-vm:~/baco_prod_dump.sql --zone=me-west1-a
```

## B4. 🖥️ Create the DB, import, run migrations, run data adjustments
```bash
cd /home/servicebaco/Baco-New

# 1) create the production DB
sudo mysql -e "CREATE DATABASE IF NOT EXISTS play_tennis \
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 2) import the dump (use the _clean file if you did the DEFINER strip)
sudo mysql --default-character-set=utf8mb4 play_tennis < ~/baco_prod_dump.sql

# 3) apply migrations 001–004 in order (all additive + idempotent)
for f in backend/migrations/0*.sql; do echo "-- $f"; sudo mysql play_tennis < "$f"; done

# 4) data adjustments — EDIT the email first!
nano docs/prod-data-adjustments.sql      # set  @admin_email := 'you@example.com'
sudo mysql play_tennis < docs/prod-data-adjustments.sql
```
`prod-data-adjustments.sql` creates `ROLE_SUPER_ADMIN` + grants it to your email,
extends each still-open court's latest schedule to the 2050 "renew" sentinel, and
retires stale historical periods. Verify (the script prints checks):
```bash
sudo mysql play_tennis -e "
  SHOW TABLES LIKE 'audit_log';
  SELECT COUNT(*) clubs FROM club;
  SELECT COUNT(*) users FROM user;
  SELECT COUNT(*) role_links FROM user_role;      -- must be thousands, not 0
  SHOW TABLES LIKE 'users_cart';                  -- must exist
"
```
If `user_role` is 0 or `users_cart` is missing → the backslash fix didn't run;
re-do B2's merge/fix and re-import.

## B5. 🖥️ Create the app DB user (least privilege — don't run as root)
```bash
sudo mysql <<'SQL'
CREATE USER IF NOT EXISTS 'baco_app'@'127.0.0.1' IDENTIFIED BY 'CHOOSE_A_STRONG_DB_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON play_tennis.* TO 'baco_app'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```

## B6. 🖥️ Write the production env files, then build/restart
### 6a. `backend/.env`
```bash
cd /home/servicebaco/Baco-New/backend
cp -n .env.example .env
nano .env
```
Set (fill real values):
```env
DATABASE_URL=mysql+pymysql://baco_app:CHOOSE_A_STRONG_DB_PASSWORD@127.0.0.1/play_tennis?charset=utf8mb4
JWT_SECRET=<paste: openssl rand -hex 32>
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440

DEV_MODE=false
PELECARD_GATEWAY_URL=https://gateway.pelecard.biz/Iframe
PELECARD_MATNASIM_TERM=<terminal>
PELECARD_MATNASIM_PASSWORD=<password>
# …one pair per club, keyed by the club's DB u_name…
APP_BASE_URL=https://baco.co.il
FRONTEND_BASE_URL=https://baco.co.il

SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@<your-mailgun-domain>
SMTP_PASSWORD=<mailgun domain SMTP password>   # do NOT reset the prod password
EMAIL_FROM=<from address on the verified domain>

ENABLE_SCHEDULER=true          # in-process scheduler (you skipped Cloud Scheduler)
```
**Generating `JWT_SECRET`** — this is the signing key for login tokens (a
password-equivalent: anyone who has it can forge a token for any user, so keep it
secret and never commit it). Generate a strong random value on the VM:
```bash
openssl rand -hex 32
```
Copy the 64-character output and paste it as the `JWT_SECRET` value in `.env`
above. Notes:
- **Set it once and keep it stable** in production. Changing it invalidates all
  existing login tokens, so every user is logged out and must sign in again.
- Use a **different** value from your dev/local `JWT_SECRET` (a leaked dev secret
  then can't forge production tokens).
- Only rotate it (generate a new one) if you suspect it leaked — accepting that
  it force-logs-out everyone.

### 6b. `frontend/.env.production`
```bash
cd /home/servicebaco/Baco-New/frontend
nano .env.production
```
```env
BACKEND_URL=http://127.0.0.1:8000
ANTHROPIC_API_KEY=<key>            # SERVER-side only — never NEXT_PUBLIC_
ANTHROPIC_WORKSPACE_ID=<workspace id>
```
### 6c. Rebuild frontend (env baked where needed) and (re)start services
```bash
cd /home/servicebaco/Baco-New/frontend && npm run build
sudo systemctl restart baco-backend baco-frontend
sudo systemctl status baco-backend baco-frontend --no-pager
```
### 6d. Local smoke test (before touching DNS)
```bash
curl -s http://127.0.0.1:8000/health
curl -sI http://127.0.0.1:3000 | head -1
```

## B7. 🖥️ Swap nginx from the temp block to the real production conf
The temp block only proxies `/`. The real conf also routes `/payment/` and
`/jobs/` to the backend (Pelecard callbacks need this) and terminates TLS.
```bash
cd /home/servicebaco/Baco-New
sudo rm -f /etc/nginx/sites-enabled/baco-temp.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo cp deploy/nginx-baco.conf /etc/nginx/sites-available/baco.conf
sudo ln -sf /etc/nginx/sites-available/baco.conf /etc/nginx/sites-enabled/baco.conf
```
**If you copied a paid cert (A8)** instead of Let's Encrypt, edit the two cert
paths in the conf now:
```bash
sudo nano /etc/nginx/sites-available/baco.conf
#   ssl_certificate     /etc/ssl/baco/fullchain.pem;
#   ssl_certificate_key /etc/ssl/baco/privkey.pem;
```
Test the config:
```bash
sudo nginx -t
```
- **If A7 (pre-issued) or A8 (copied) is done → certs exist →** `nginx -t` passes:
  ```bash
  sudo systemctl reload nginx
  ```
- **If you did NOT pre-issue** (deferring to B9 option 3), `nginx -t` will fail on
  the missing cert. Leave the temp block in place for now and issue the cert right
  after the DNS flip (B9), then swap.

## B8. 🏢 FLIP DNS — the cutover moment
In box.co.il's DNS panel, change the **A record(s)**:
- Host `@` (baco.co.il) → **the new static IP** (from A2)
- Host `www` → the same IP
- TTL 300 (as set in A3)
Save. Because TTL was lowered, most clients pick up the new IP within ~5 minutes.
Confirm from your 💻 laptop:
```bash
nslookup baco.co.il           # should now return the NEW static IP
```

## B9. 🖥️ Ensure HTTPS is live
Pick the path matching your cert choice:
1. **Pre-issued (A7) or copied (A8):** already reloaded in B7 — just verify (C).
2. **Issue now, after the flip (if you skipped A7):** now that DNS points here and
   port 80 is open, let certbot get + install the cert and add the 443 block:
   ```bash
   sudo certbot --nginx -d baco.co.il -d www.baco.co.il
   sudo nginx -t && sudo systemctl reload nginx
   ```
   (A few seconds of "no HTTPS yet" between the flip and this completing.)

## B10. 🌐 Firewall — confirm ports
- **☰ → Compute Engine → VM instances → `baco-vm` → Edit:** ensure **Allow HTTP**
  and **Allow HTTPS** are ticked (80 + 443).
- **☰ → VPC network → Firewall:** restrict `default-allow-ssh` (22) to your own IP.
- **Never** open 8000 / 3000 / 3306 — the app and MySQL bind to `127.0.0.1`.

---

# PART C — Post-cutover verification

## C1. 🖥️ Services all up and enabled for reboot
```bash
systemctl is-active mysql baco-backend baco-frontend nginx
sudo systemctl enable mysql baco-backend baco-frontend nginx   # survive reboots
```

## C2. 💻 HTTPS reachable and valid
```bash
curl -sI https://baco.co.il | head -1        # HTTP/2 200
curl -sI http://baco.co.il  | head -1        # 301 → https
```
Open `https://baco.co.il` in a browser — padlock present, no cert warning.

## C3. Functional smoke test (browser, over HTTPS)
- Log in with a real account from the imported data.
- Search for a court; confirm availability shows.
- **Book with a real/PeleTest card** → Pelecard iframe → redirects back → order
  confirmed (this exercises the `/payment/` nginx route + `APP_BASE_URL`).
- Confirm the confirmation **email** arrives (Mailgun).
- Log in as the super-admin (the email from B4) → admin screens load → the
  **rebuild** button works.

## C4. 🖥️ Scheduler running in-process
```bash
sudo journalctl -u baco-backend | grep -i scheduler | tail
```
The nightly `rebuild` fires at **01:00 Asia/Jerusalem**; `release_orders` every
10 min. **The VM must now stay ON 24/7** — stop the daily 17:00 shutdown, or the
site is down and the rebuild never fires.

## C5. 🌐 Backups + monitoring
- **Disk snapshot schedule:** **☰ → Compute Engine → Snapshots → Snapshot
  schedules → Create** (daily, keep 7–14 days) → attach to the VM's disk
  (**Disks → baco-vm disk → Edit → Snapshot schedule**). This is your DB backup.
- **Uptime check:** **☰ → Monitoring → Uptime checks → Create** for
  `https://baco.co.il`.

## C6. 🖥️ TLS auto-renewal (if you used Let's Encrypt)
```bash
sudo certbot renew --dry-run
```
- If you did the **DNS-01 manual** pre-issue (A7), that cert won't auto-renew via
  HTTP. Now that DNS points at the VM, re-issue once through the nginx plugin so
  renewals are automatic:
  ```bash
  sudo certbot --nginx -d baco.co.il -d www.baco.co.il
  ```
  certbot installs a systemd timer; the dry-run above confirms it works.

## C7. Decommission the old site (after a safe observation period)
Once the new site is verified and stable for a day or two, retire the old VM/DB.
Keep a final backup of the old data first. Don't rush this — it's your rollback.

---

# PART D — Rollback (if something goes wrong at cutover)

The fastest rollback is **DNS**: point the A records back at the **old** server.
1. 🏢 In box.co.il, set `@` and `www` A records back to the **old** IP (TTL 300 →
   propagates in minutes).
2. The old site (still running, since you didn't decommission it) serves again.
3. Investigate on the new VM without time pressure; re-attempt cutover later.

Because Part A never touched DNS and the old site stays up until C7, rollback is
low-risk throughout.

---

## One-glance checklist
- [ ] A1 code pulled (incl. Next.js 15.5.26)
- [ ] A2 static IP reserved + attached
- [ ] A3 DNS TTL lowered to 300
- [ ] A4–A6 prereqs, venv, frontend build
- [ ] A7 **or** A8 TLS cert ready
- [ ] B1 old site booking freeze
- [ ] B2 fresh dump (+ backslash fix if Toad)
- [ ] B3 dump on VM
- [ ] B4 DB created, imported, migrations, data-adjustments (+ verify counts)
- [ ] B5 baco_app DB user
- [ ] B6 backend/.env (DEV_MODE=false, Pelecard, Mailgun, DATABASE_URL) + frontend/.env.production + rebuild + restart
- [ ] B7 nginx real conf
- [ ] B8 DNS flipped to static IP
- [ ] B9 HTTPS live
- [ ] B10 firewall 80/443 only
- [ ] C1–C4 services enabled, HTTPS valid, booking+email+admin tested, scheduler + 24/7
- [ ] C5 backups + uptime
- [ ] C6 cert auto-renew
- [ ] C7 old site decommissioned (later)
