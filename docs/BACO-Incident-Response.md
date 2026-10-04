# BACO / TennisLine — מקרים ותגובות (Production Incident Response)

Step-by-step playbooks for things that can go wrong on the live site
(https://baco.co.il) and exactly how to fix each. Keep this handy; work top-down
through the relevant section.

---

## 0. Environment cheat-sheet (know this before anything breaks)

| Thing | Value |
|---|---|
| Site | https://baco.co.il (+ www) |
| VM | GCP e2-medium, region **me-west1**, user **`servicebaco`** |
| Repo on VM | `/home/servicebaco/Baco-New` |
| Backend | systemd **`baco-backend`** — FastAPI/uvicorn on `127.0.0.1:8000` (single instance) |
| Frontend | systemd **`baco-frontend`** — Next.js `next start` on `127.0.0.1:3000` |
| Web server | systemd **`nginx`** — ports 80/443, conf `/etc/nginx/sites-available/baco.conf` |
| Database | systemd **`mysql`** — MySQL 8.4, DB **`play_tennis`**, app user `baco_app@127.0.0.1`, admin via `sudo mysql` |
| TLS | Let's Encrypt (certbot **nginx** plugin, auto-renew timer `certbot.timer`), certs in `/etc/letsencrypt/live/baco.co.il/` |
| Scheduler | in-process (`ENABLE_SCHEDULER=true`): rebuild **23:00** Asia/Jerusalem, release-orders every 10 min |
| Config | `backend/.env` (DB creds, JWT, Pelecard, Mailgun, APP_BASE_URL/FRONTEND_BASE_URL=https://baco.co.il), `frontend/.env.production` (BACKEND_URL, ANTHROPIC_*) — **git-ignored, per-VM** |
| Git remote | `github.com/erezsh98/Baco-New` (branch `main`) |
| Backups | daily disk snapshots (me-west1, keep 14 days); optional `mysqldump` |

### The two commands you'll use most
**Deploy latest code:**
```bash
cd ~/Baco-New && git checkout -- frontend/package-lock.json 2>/dev/null; git pull
cd frontend && npm run build
sudo systemctl restart baco-backend baco-frontend
```
**Restart everything:**
```bash
sudo systemctl restart mysql baco-backend baco-frontend nginx
```

---

## 1. 🔴 60-second triage — "the site is down / broken"

Run these first to localize the problem, then jump to the matching section.

```bash
# 1) Are all services up?
systemctl is-active mysql baco-backend baco-frontend nginx

# 2) Does the backend answer locally?
curl -s http://127.0.0.1:8000/health

# 3) Does the frontend answer locally?
curl -sI http://127.0.0.1:3000 | head -1

# 4) Does nginx serve HTTPS?
curl -sI https://baco.co.il | head -1

# 5) Disk and memory OK?
df -h /        # root disk usage
free -h        # memory
```

Interpret:
- A service shows **`inactive`/`failed`** → **§4 (service down)**, then the service-specific section.
- Backend health fails but process is "active" → **§3 (backend bug/crash)**.
- `curl https://baco.co.il` fails but `:3000`/`:8000` are fine → **nginx or TLS**: §5 / §6.
- HTTPS cert warning in browser → **§6 (certificate)**.
- `df -h` shows **100%** → **§8 (disk full)** — fix this first, it breaks everything.
- MySQL down → **§7**.
- Everything green locally but users can't reach it → **§9 (DNS/network/IP)**.

---

## 2. 🐛 Deploy a frontend bug fix

1. **Fix the code** locally (your dev machine), commit, push:
   ```bash
   git add <files> && git commit -m "fix: ..." && git push
   ```
2. **On the VM**, pull + rebuild + restart the frontend:
   ```bash
   cd ~/Baco-New
   git checkout -- frontend/package-lock.json 2>/dev/null   # drop VM's lockfile churn
   git pull
   cd frontend
   npm install            # only if dependencies changed; otherwise skip
   npm run build          # REQUIRED for any frontend change
   sudo systemctl restart baco-frontend
   ```
3. **Verify:**
   ```bash
   sudo systemctl status baco-frontend --no-pager
   curl -sI http://127.0.0.1:3000 | head -1       # HTTP 200
   ```
   Then hard-refresh the page in a browser (Ctrl+Shift+R / new private tab) to bypass cache.
4. If the build **fails**, the old build keeps serving (the running service isn't replaced until a successful build + restart). Fix the error, rebuild, restart.

> Static files under `frontend/public/` (e.g. a club `takanon.pdf`) just need `git pull` — no rebuild required.

---

## 3. 🐛 Deploy a backend bug fix

1. **Fix, commit, push** from your dev machine.
2. **On the VM:**
   ```bash
   cd ~/Baco-New
   git checkout -- frontend/package-lock.json 2>/dev/null
   git pull
   cd backend
   .venv/bin/python -m pip install -r requirements.txt   # only if requirements changed
   sudo systemctl restart baco-backend
   ```
3. **Verify:**
   ```bash
   sudo systemctl status baco-backend --no-pager
   curl -s http://127.0.0.1:8000/health
   sudo journalctl -u baco-backend -n 30 --no-pager      # watch for a clean start / traceback
   ```
4. **If the backend won't start after the change** (crash loop), see §4; to get back online fast, roll back (§10).

> A **DB schema change** needs its migration applied: `sudo mysql play_tennis < backend/migrations/00X_*.sql` **before** restarting the backend.

---

## 4. ⚙️ A service is down / crashed (backend, frontend, nginx, mysql)

Replace `<svc>` with `baco-backend`, `baco-frontend`, `nginx`, or `mysql`.

1. **Status + why it died:**
   ```bash
   sudo systemctl status <svc> --no-pager
   sudo journalctl -u <svc> -n 50 --no-pager
   ```
2. **Try to start it:**
   ```bash
   sudo systemctl restart <svc>
   sudo systemctl is-active <svc>
   ```
3. **If it won't stay up**, read the journal for the error:
   - **backend** — Python traceback → a code/config/DB problem. Common: bad `backend/.env` (wrong `DATABASE_URL`), or MySQL down (fix §7 first). Fix the cause, then restart.
   - **frontend** — usually a missing build (`.next`) or bad `npm run build`. Rebuild: `cd ~/Baco-New/frontend && npm run build && sudo systemctl restart baco-frontend`.
   - **nginx** — config error. Test it: `sudo nginx -t` (it prints the offending line/file). Fix the conf, then `sudo systemctl reload nginx`.
   - **mysql** — see §7.
4. **Ensure it auto-starts on reboot** (so a VM reboot doesn't leave it down):
   ```bash
   sudo systemctl enable mysql baco-backend baco-frontend nginx
   ```

---

## 5. 🌐 nginx / reverse-proxy issues (502 / 504 / wrong page)

- **502 Bad Gateway** = nginx can't reach the app behind it.
  ```bash
  sudo ss -tlnp | grep -E ':3000|:8000'     # are frontend/backend listening?
  sudo systemctl restart baco-backend baco-frontend
  ```
  If the ports aren't listening, fix those services (§4) — nginx is fine.
- **504 Gateway Timeout** = the backend took too long (e.g., a heavy operation). The conf already sets `proxy_read_timeout 600s` for `/` and `/jobs/`; confirm the current conf has it, and check what's slow in `journalctl -u baco-backend`.
- **nginx won't reload / config error:**
  ```bash
  sudo nginx -t                              # shows the error location
  # fix the file, then:
  sudo systemctl reload nginx
  ```
- **Restore the known-good nginx conf** from the repo if it got mangled:
  ```bash
  sudo cp ~/Baco-New/deploy/nginx-baco.conf /etc/nginx/sites-available/baco.conf
  # (re-add your real cert paths if you use non-Let's-Encrypt; LE paths are already in it)
  sudo nginx -t && sudo systemctl reload nginx
  ```

---

## 6. 🔒 Certificate / HTTPS issues

**Symptoms:** browser "Not secure" / cert expired / `curl: (60) SSL` errors.

1. **Check expiry + what's installed:**
   ```bash
   sudo certbot certificates                 # lists certs, domains, expiry dates
   ```
2. **Force a renewal now** (if near/after expiry):
   ```bash
   sudo certbot renew --force-renewal
   sudo systemctl reload nginx
   ```
3. **Confirm auto-renew is healthy** (so this doesn't recur):
   ```bash
   sudo certbot renew --dry-run              # must end "all simulated renewals succeeded"
   systemctl list-timers | grep certbot      # the renewal timer should be listed
   ```
4. **If renewal fails:**
   - It needs **port 80 reachable** (HTTP-01). Verify §9 / firewall, and `sudo ss -tlnp | grep :80`.
   - Read `/var/log/letsencrypt/letsencrypt.log` for the exact reason.
   - Re-issue via nginx (also repairs the renewal config):
     ```bash
     sudo certbot --nginx -d baco.co.il -d www.baco.co.il
     ```
5. **If HTTPS is totally broken and you must restore service fast:** the cert files live at `/etc/letsencrypt/live/baco.co.il/`. If they're intact but nginx lost the reference, restore the conf (§5) and reload.

> Certs are valid 90 days and auto-renew at 30 days left. If `certbot certificates` shows a comfortable expiry and `--dry-run` passes, you have nothing to do.

---

## 7. 🗄️ MySQL issues

### 7a. MySQL won't start
```bash
sudo systemctl status mysql --no-pager
sudo journalctl -u mysql -n 60 --no-pager
sudo tail -n 60 /var/log/mysql/error.log
sudo systemctl restart mysql
```
Common causes in the log:
- **Disk full** → §8 (free space, then start MySQL).
- **Corrupted table / crashed** → InnoDB usually auto-recovers on start; if a specific table is corrupt, the log names it — restore from backup (§7d) or `CHECK TABLE` / `REPAIR TABLE`.
- **Permissions on `/var/lib/mysql`** → `sudo chown -R mysql:mysql /var/lib/mysql` then start.

### 7b. App can't connect to the DB ("Access denied" / "Can't connect")
```bash
sudo ss -tlnp | grep 3306                    # MySQL listening on 127.0.0.1:3306?
sudo mysql -e "SELECT 1;"                     # DB reachable as root?
grep DATABASE_URL ~/Baco-New/backend/.env     # creds the app uses
```
- Wrong creds → fix `DATABASE_URL` in `backend/.env`, `sudo systemctl restart baco-backend`.
- App user missing after a DB restore → recreate the grant:
  ```bash
  sudo mysql -e "CREATE USER IF NOT EXISTS 'baco_app'@'127.0.0.1' IDENTIFIED BY '<pw>'; \
    GRANT SELECT,INSERT,UPDATE,DELETE ON play_tennis.* TO 'baco_app'@'127.0.0.1'; FLUSH PRIVILEGES;"
  ```

### 7c. Take a manual DB backup (do this BEFORE any risky DB operation)
```bash
sudo mysqldump --single-transaction --default-character-set=utf8mb4 play_tennis \
  > ~/play_tennis_backup_$(date +%F_%H%M).sql
ls -lh ~/play_tennis_backup_*.sql
```

### 7d. Restore the DB from a dump (data loss / bad data / rollback)
```bash
sudo systemctl stop baco-backend                      # stop writes
# safety copy of current state first:
sudo mysqldump --single-transaction play_tennis > ~/play_tennis_before_restore_$(date +%F_%H%M).sql
sudo mysql -e "DROP DATABASE play_tennis; CREATE DATABASE play_tennis \
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql --default-character-set=utf8mb4 play_tennis < ~/<the-good-backup>.sql
# if restoring a RAW production dump (not an app backup), also run migrations + adjustments:
#   for f in ~/Baco-New/backend/migrations/0*.sql; do sudo mysql play_tennis < "$f"; done
#   sudo mysql play_tennis < ~/Baco-New/docs/prod-data-adjustments.sql   (edit @admin_email)
sudo mysql -e "GRANT SELECT,INSERT,UPDATE,DELETE ON play_tennis.* TO 'baco_app'@'127.0.0.1'; FLUSH PRIVILEGES;"
sudo systemctl start baco-backend
```
Full detail: [`BACO-Go-Live-Cutover-Checklist.md`](BACO-Go-Live-Cutover-Checklist.md) §B4-alt and [`DB-Prod-Copy-Guide.md`](DB-Prod-Copy-Guide.md).

---

## 8. 💾 Disk full

Symptoms: MySQL/backend crashing, "No space left on device", site erroring.
```bash
df -h /                                        # confirm root is ~100%
sudo du -xhd1 / 2>/dev/null | sort -h | tail   # biggest top-level dirs
```
Common culprits + cleanup:
```bash
sudo journalctl --vacuum-time=7d               # trim old systemd logs
sudo du -shc ~/Baco-New/frontend/.next ~/*.sql ~/play_tennis_backup_*.sql
# remove old DB backups you no longer need:
ls -lh ~/play_tennis_backup_*.sql
# rm ~/play_tennis_backup_OLD.sql
# clear apt cache:
sudo apt clean
```
If genuinely out of space, **grow the disk** (GCP): Console → Compute Engine → Disks → `baco-vm` disk → **Edit → increase Size → Save**, then on the VM:
```bash
sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1    # device may be /dev/sda or /dev/nvme0n1 — check `lsblk`
df -h /
```
Then start whatever crashed (`sudo systemctl start mysql baco-backend`).

---

## 9. 🌍 Site unreachable from the internet (local checks pass)

Everything green on the VM but users (or `curl https://baco.co.il` from your laptop) can't reach it.

1. **DNS still points at the VM?**
   ```bash
   nslookup baco.co.il            # must return the VM's static IP
   curl -s ifconfig.me; echo      # the VM's current external IP
   ```
   If they differ → the IP changed (should not happen with a **static** IP; if it's ephemeral, fix: reserve+attach a static IP, then update the A records at box.co.il).
2. **Firewall** — GCP must allow **80 + 443**: Console → VM → Edit → "Allow HTTP/HTTPS traffic" ticked (or VPC → Firewall rules). Never open 3306/8000/3000.
3. **From your laptop:** `curl -sI https://baco.co.il | head -1`. Timeout = network/firewall; TLS error = §6.

---

## 10. ↩️ Roll back a bad deploy (fast recovery)

If a just-deployed change broke production, revert to the previous commit.
```bash
cd ~/Baco-New
git log --oneline -5                 # find the last good commit hash
git reset --hard <good_commit_hash>  # or: git revert <bad_commit> for a clean history
# rebuild frontend if it was involved:
cd frontend && npm run build
sudo systemctl restart baco-backend baco-frontend
```
Verify with §1. Then fix the bug properly on your dev machine and redeploy via §2/§3.

> Prefer `git revert <bad_commit>` (makes a new undo-commit) if you want to keep history clean and push the revert back to GitHub. `git reset --hard` is fine for a quick local rollback but diverges from origin until you sort it out.

---

## 11. 🔁 Full VM / disk restore from a snapshot (worst case)

Use when the VM is corrupted, the disk is damaged, or a change is unrecoverable.

**Option A — new VM from the snapshot (safest; keeps the broken one for forensics):**
1. Console → **Compute Engine → Snapshots** → pick the most recent good snapshot → note its name.
2. **Create a disk from it:** Snapshots → the snapshot → **Create disk** (or Disks → Create → Source: Snapshot), region **me-west1**.
3. **Create a new VM** using that disk as the boot disk (Create instance → Boot disk → **Existing disk** → select it), same machine type (e2-medium), region me-west1.
4. **Move the static IP** to the new VM: VPC → IP addresses → detach from old VM / attach `baco-ip` to the new one (or the new VM's network interface → External IP → the reserved one). DNS stays unchanged because the IP follows.
5. SSH in, confirm services come up (they're enabled), run §1 checks.
6. Once verified, delete the broken VM.

**Option B — restore in place (swap the boot disk):**
1. **Stop** the VM (Console → VM → Stop).
2. Create a disk from the good snapshot (step 2 above).
3. VM → **Edit** → detach the current boot disk, attach the restored disk as boot.
4. **Start** the VM, SSH in, run §1 checks.

> Snapshots are **crash-consistent**; MySQL/InnoDB recovers on boot, so the DB comes up clean. After restore, verify data with:
> `sudo mysql play_tennis -e "SELECT COUNT(*) FROM court_order; SELECT MAX(order_date) FROM court_order;"`
> You lose only data written **after** the snapshot was taken (up to ~24h with daily snapshots).

---

## 12. 📅 Availability not updating / nightly rebuild didn't run

- **Managers' edits not visible to users** → availability only changes on a rebuild. A manager clicks **"עדכן זמינות"** per club, or run it manually. Check it worked:
  ```bash
  sudo journalctl -u baco-backend | grep -i "rebuild START\|rebuild DONE\|rebuild FAILED" | tail
  ```
- **Nightly 23:00 rebuild didn't run** → the VM must be **on at 23:00** (it's in-process). Confirm `ENABLE_SCHEDULER=true` in `backend/.env` and the backend was running at 23:00. A `rebuild FAILED` line shows the traceback → fix and re-run from the admin UI.
- **All-clubs rebuild shows an error but completes** → that's expected for long runs; it runs in the background (returns immediately). Confirm via the `rebuild DONE` log line.

---

## 13. 💳 Payment / Pelecard issues

- **"Your request triggered an alert"** = Pelecard's security blocking an unregistered **source IP** or **domain**. Fix is Pelecard-side: have them whitelist the **VM's static IP** and register **baco.co.il** for the terminal. (See [[pelecard]] note.)
- **Charges show as "הוראת קבע"** = a token/recurring was created. The code deliberately omits `frmAction=CreateToken`; if it recurs, verify the deployed code is current and check the terminal type with Pelecard.
- **Payment fails / wrong terminal** → check `backend/.env` has the right `PELECARD_<UNAME>_TERM/_PASSWORD` for that club (suffix = club `u_name` upper-cased), `DEV_MODE=false`, and `APP_BASE_URL=https://baco.co.il`. After editing `.env`: `sudo systemctl restart baco-backend`.
- Diagnose a specific failure: `sudo journalctl -u baco-backend | grep -i pelecard | tail`.

---

## 14. ✉️ Email not sending (confirmations, password reset)

- Email goes through **Mailgun**. Reset links use `FRONTEND_BASE_URL` — if a link points to `localhost`, that var isn't set: `grep FRONTEND_BASE_URL backend/.env` (must be `https://baco.co.il`), then restart the backend.
- Check backend logs for SMTP errors: `sudo journalctl -u baco-backend | grep -i -E "smtp|mail|email" | tail`.
- **Do NOT reset the Mailgun SMTP password.** If Mailgun creds are wrong, fix `SMTP_USER/SMTP_PASSWORD` in `.env` to the correct Mailgun values and restart.
- Verify DNS email records at box.co.il are intact (SPF `v=spf1 include:mailgun.org`, DKIM `pic._domainkey`, MX) — these were untouched at cutover and should stay.

---

## 15. 🧠 High memory / CPU / slowness

```bash
free -h                                  # memory
top    # or: htop        (q to quit)     # what's eating CPU/RAM
sudo systemctl status baco-backend baco-frontend --no-pager
```
- A heavy **all-clubs rebuild** spikes CPU briefly — normal; it finishes in tens of seconds (watch `journalctl`).
- Backend out of memory / killed → check `sudo journalctl -k | grep -i oom`. If recurring, consider a bigger machine type (e2-standard) temporarily: Console → VM → Stop → Edit → machine type → Start.
- Quick relief: `sudo systemctl restart baco-backend baco-frontend`.

---

## 16. 🔎 Logs & diagnostics cheat-sheet

```bash
# live tail a service:
sudo journalctl -u baco-backend -f
sudo journalctl -u baco-frontend -f
# recent errors:
sudo journalctl -u baco-backend -n 100 --no-pager
# nginx access/error:
sudo tail -n 100 /var/log/nginx/error.log
sudo tail -n 100 /var/log/nginx/access.log
# mysql:
sudo tail -n 100 /var/log/mysql/error.log
# certbot:
sudo tail -n 100 /var/log/letsencrypt/letsencrypt.log
# what's listening:
sudo ss -tlnp
# disk / memory:
df -h /   ;   free -h
```

---

## 17. 📞 Escalation & references

- **Code/config history:** `github.com/erezsh98/Baco-New` (branch `main`) — `git log` on the VM shows the deployed commit.
- **Runbooks:** [`BACO-Production-Setup-Guide.md`](BACO-Production-Setup-Guide.md), [`BACO-Go-Live-Cutover-Checklist.md`](BACO-Go-Live-Cutover-Checklist.md), [`Native-VM-Runbook.md`](Native-VM-Runbook.md), [`DB-Prod-Copy-Guide.md`](DB-Prod-Copy-Guide.md), [`GCP-Setup-Guide.md`](GCP-Setup-Guide.md), [`Background-Jobs-Deployment.md`](Background-Jobs-Deployment.md).
- **Vendors:** Pelecard support (terminal/IP/domain whitelist), Mailgun (email), box.co.il (DNS), Google Cloud support (VM/infra).
- **Fill in your contacts:** Pelecard terminal numbers + support line; Mailgun account; GCP project id; box.co.il login.

---

### Golden rules
1. **Back up before any risky change** — `mysqldump` (§7c) before DB ops; `git log` to note the current commit before deploys; snapshots run daily.
2. **One change at a time**, then re-verify with §1.
3. **Read the log before acting** — the journal almost always names the cause.
4. **On a failed build/deploy, the old version keeps running** until a successful restart — so you're never worse off for trying.
5. **Never open 3306 / 8000 / 3000** to the internet; never commit `.env`; never reset the Mailgun password.
