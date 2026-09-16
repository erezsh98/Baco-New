# GCP Setup Guide (Console / GUI) — hosting BACO from a new account

Everything below is done in the **Google Cloud Console** (https://console.cloud.google.com),
via the GUI. Each step links to the official Google doc, which contains current
screenshots (Google's console changes often, so the official pages are the
reliable source for the exact visuals).

This guide covers **GCP infrastructure only**. The app install (MySQL 8.4,
Python/Node/nginx, systemd, certbot TLS) is in
[`Native-VM-Runbook.md`](Native-VM-Runbook.md) and runs on the VM afterwards.

All navigation starts at the top-left **☰ (Navigation menu)**.

**Order that matters:** reserve IP → create VM (attach IP, open 80/443) → set the
DNS A record to that IP → wait for DNS → then run the runbook (which does certbot TLS).

---

## Phase 0 — Billing & budget
- Sign in and accept the Terms.
- Add a billing account: **☰ → Billing → Manage billing accounts → Add billing account** (enter a card; new accounts usually get free trial credit).
- Set a budget: **☰ → Billing → Budgets & alerts → Create budget** → amount (e.g. $60) + alert thresholds (50 / 90 / 100 %).
- Docs (screenshots): https://cloud.google.com/billing/docs/how-to/budgets

## Phase 1 — Project & Compute Engine API
- Top bar **project dropdown → New Project** → name `baco-prod` → **Create**; select it in the top bar.
- Confirm billing is linked: **☰ → Billing**.
- Enable Compute Engine: **☰ → Compute Engine → VM instances** → first visit shows **Enable** (click, wait ~1 min).
- Docs: https://cloud.google.com/resource-manager/docs/creating-managing-projects

## Phase 2 — Reserve a static external IP
- **☰ → VPC network → IP addresses → Reserve external static address**.
- Name `baco-ip` · Type **Regional** · Region **me-west1 (Tel Aviv)** · **Reserve**. Note the IP.
- Docs (screenshots): https://cloud.google.com/compute/docs/ip-addresses/reserve-static-external-ip-address

## Phase 3 — Create the VM
- **☰ → Compute Engine → VM instances → Create instance**:
  - **Name** `baco-vm` · **Region** me-west1 · **Zone** me-west1-a.
  - **Machine configuration**: series **E2**, type **e2-medium (2 vCPU, 4 GB)**.
  - **Boot disk → Change**: **Debian 12** (or Ubuntu 24.04 LTS) · **Balanced persistent disk** · **30 GB** → **Select**.
  - **Firewall**: tick **Allow HTTP traffic** and **Allow HTTPS traffic**.
  - **Advanced → Networking → Network interfaces**: set **External IPv4 address** = **baco-ip**.
  - Availability policy: leave **Standard** (not Spot).
  - **Create**.
- Connect: on the instance row click **SSH** (browser terminal).
- Docs (screenshots): https://cloud.google.com/compute/docs/instances/create-start-instance · SSH: https://cloud.google.com/compute/docs/instances/ssh

## Phase 4 — Firewall (optional SSH hardening)
- **☰ → VPC network → Firewall** → open `default-allow-ssh` → restrict **Source IPv4 ranges** to your own IP (instead of `0.0.0.0/0`).
- 80/443 were added by the VM's HTTP/HTTPS checkboxes. **Never** open 8000/3000/3306 — the app binds backend to `127.0.0.1:8000` and the frontend to `:3000` behind nginx.
- Docs: https://cloud.google.com/firewall/docs/using-firewalls

## Phase 5 — DNS (baco.co.il → the static IP)
Pick one:
- **At your registrar (simplest):** DNS settings → add an **A record**: host `@` (and `www`) → value = the static IP, TTL 300.
- **Cloud DNS:** **☰ → Network services → Cloud DNS → Create zone** (Public) → **Add standard record set** → type **A**, IPv4 = static IP (do it for `@` and `www`) → then set your registrar's **nameservers** to the ones Cloud DNS lists.
- Verify: `nslookup baco.co.il` → your static IP (needed before certbot TLS).
- Docs (screenshots): https://cloud.google.com/dns/docs/set-up-dns-records-domain-name

## Phase 5b — SSL / HTTPS (TLS)
For this **single-VM** setup, HTTPS is provided by **certbot + Let's Encrypt on the
VM's nginx** — free and auto-renewing. GCP is not the certificate authority here;
it just supplies the prerequisites, which the earlier phases already set up:
- **Port 443 open** — the "Allow HTTPS" checkbox on the VM (Phase 3).
- **Port 80 open** — the "Allow HTTP" checkbox (Phase 3); certbot's HTTP-01
  challenge needs it.
- **DNS resolving** `baco.co.il` → the VM's static IP (Phase 5).

The certificate is issued **on the VM** as part of the runbook's nginx step:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d baco.co.il -d www.baco.co.il
```
Certbot adds the `:443` server block + an HTTP→HTTPS redirect, installs a 90-day
cert, and sets up **auto-renewal** (a systemd timer). Check it with
`sudo certbot renew --dry-run`.

> **GCP-managed certificate** is a different path — it applies only if you put a
> **GCP External HTTPS Load Balancer** in front of the VM (Google then provisions
> and renews the cert and terminates TLS at the load balancer). That is extra
> infrastructure and cost, and is **not needed** for the single-VM/certbot setup;
> consider it only if you later add a load balancer.

### Certificate during cutover (migrating from an existing live site)
A TLS certificate belongs to the **domain**, not to a GCP project or server, so
there's nothing to "move between projects" — the only question is how the new VM
gets a valid cert for `baco.co.il` while the old site is still serving it.

- **If the old cert is Let's Encrypt (free): create a fresh one** on the new VM —
  don't copy it. Reissuing is trivial and keeps auto-renewal clean.
- **If the old cert is a paid CA cert with real remaining validity:** you may
  simply **copy its certificate chain + private key** to the new VM and point
  nginx at them. The same cert is valid on any server for that domain, and this
  works even before DNS is switched.

The wrinkle: Let's Encrypt's default **HTTP-01** validation needs `baco.co.il` to
already point at the machine requesting the cert — but during cutover it still
points at the **old** site. For **zero downtime**, pick one:

1. **DNS-01 challenge (recommended — issue before cutover).** Validates via a DNS
   TXT record instead of HTTP, so the new VM can get the cert while the old site
   is still live; then you just flip DNS and HTTPS is already ready:
   ```bash
   sudo certbot certonly --manual --preferred-challenges dns \
     -d baco.co.il -d www.baco.co.il
   ```
   Add the TXT record it prints (automatable when DNS is Cloud DNS or another
   supported provider).
2. **Temp subdomain.** Point `new.baco.co.il` → the new VM, get a cert for that,
   validate the site, then reissue for `baco.co.il` right after the DNS flip.
3. **Issue after the flip.** Repoint DNS, then immediately run `certbot --nginx`
   on the new VM — a few seconds of "no HTTPS yet" until it completes.

## Phase 6 — Backups & operations (GUI)
- **Disk snapshot schedule** (this is your DB backup, since MySQL lives on the disk):
  **☰ → Compute Engine → Snapshots → Snapshot schedules → Create** (daily, keep 7–14 days), then **Disks → baco-vm disk → Edit → Snapshot schedule** → attach it.
  Docs (screenshots): https://cloud.google.com/compute/docs/disks/scheduled-snapshots
- **Cloud Scheduler** (only if driving the jobs externally — see
  [`Background-Jobs-Deployment.md`](Background-Jobs-Deployment.md)):
  **☰ → Cloud Scheduler → Create job** (enable API if prompted) → HTTP, URL
  `https://baco.co.il/jobs/rebuild`, header `X-Scheduler-Token`. Otherwise the
  in-process scheduler on the single VM is fine.
- **Uptime alert:** **☰ → Monitoring → Uptime checks → Create** for `https://baco.co.il`.
- **Security:** enable 2-Step Verification on the Google account; keep SSH restricted; patch the OS (`apt upgrade`).

---

## Then: install the app
With the VM up and **DNS resolving to it**, open the VM's **SSH** terminal and follow
[`Native-VM-Runbook.md`](Native-VM-Runbook.md) — it installs MySQL 8.4, the app,
the systemd services, nginx, and certbot (certbot needs **port 80 open + DNS
pointing at the VM**, which Phases 2–5 provide).

> Screenshots: this guide intentionally links to Google's official docs for each
> step rather than embedding images, because the Cloud Console UI changes
> frequently and the official pages stay current. If you get stuck on a specific
> screen, capture it and it can be walked through click-by-click.
