# Background Jobs — Deployment (GCP / Cloud Scheduler)

BACO has two recurring background jobs:

| Job | What it does | Cadence |
|-----|--------------|---------|
| `rebuild` | Rebuilds bookable availability for **all** clubs (delete + recreate free slots, apply holidays). | daily, ~01:00 |
| `release_uncompleted_orders` | Frees court slots stuck in a cart for >10 minutes without payment. | every 10 minutes |

There are **two ways** to run them. Pick one — do **not** run both, or each job fires twice.

---

## Option 1 — In-process scheduler (default; simplest)

The backend runs an in-process APScheduler that fires both jobs on the schedule
above (timezone `Asia/Jerusalem`). This is the default and needs no extra setup.

**Requirements:** the backend must be a **single, always-on** process.
- ✅ Fine on a GCE VM or a single GKE pod that runs 24/7.
- ⚠️ **Do not** run more than one instance/replica, and don't start uvicorn/gunicorn
  with multiple workers — each process runs its own scheduler, so the jobs would
  run N times (concurrent `rebuild` runs can race).
- ⚠️ **Not suitable for Cloud Run** unless you set **min-instances ≥ 1** *and*
  **CPU "always allocated"**; otherwise the instance is frozen between requests
  and the jobs won't fire. For Cloud Run, use Option 2 instead.

**Env:**
```
ENABLE_SCHEDULER=true      # (default)
# SCHEDULER_TOKEN can stay blank — the /jobs endpoints are not used here.
```

---

## Option 2 — External scheduler (GCP Cloud Scheduler → HTTP endpoints)

Turn off the in-process scheduler and let **Cloud Scheduler** call the jobs over
HTTP. This mirrors how the legacy Grails app ran (an external cron hitting
`/rentalTamplate/rebuild` and `/rentalTamplate/releaseUncompletedOrders`), and is
the right choice for Cloud Run or any multi-instance deployment.

The jobs are exposed as:

| Method & path | Job |
|---------------|-----|
| `POST /jobs/rebuild` | `rebuild` (all clubs) |
| `POST /jobs/release-orders` | `release_uncompleted_orders` |

Auth is a **shared secret** sent in the `X-Scheduler-Token` header (not a login).
It fails closed: with no `SCHEDULER_TOKEN` set the endpoints return **503**; a
wrong/missing token returns **403**; a correct token returns **200**.

### 1. Backend env

```
ENABLE_SCHEDULER=false                      # don't also run the jobs in-process
SCHEDULER_TOKEN=<a long random secret>      # e.g. `openssl rand -hex 32`
```

Keep `SCHEDULER_TOKEN` secret (Secret Manager / pipeline secret) — anyone with it
can trigger a rebuild.

### 2. Create the two Cloud Scheduler jobs

Timezone: **Asia/Jerusalem**. Target type: **HTTP**, method **POST**, with the
header `X-Scheduler-Token: <the same secret>`.

Console: Cloud Scheduler → **Create job** for each, or via `gcloud`:

```bash
# Nightly availability rebuild — 01:00 every day
gcloud scheduler jobs create http baco-rebuild \
  --schedule="0 1 * * *" \
  --time-zone="Asia/Jerusalem" \
  --uri="https://baco.co.il/jobs/rebuild" \
  --http-method=POST \
  --headers="X-Scheduler-Token=REPLACE_WITH_SECRET" \
  --attempt-deadline=600s

# Release stale unpaid carts — every 10 minutes
gcloud scheduler jobs create http baco-release-orders \
  --schedule="*/10 * * * *" \
  --time-zone="Asia/Jerusalem" \
  --uri="https://baco.co.il/jobs/release-orders" \
  --http-method=POST \
  --headers="X-Scheduler-Token=REPLACE_WITH_SECRET" \
  --attempt-deadline=120s
```

> `rebuild` can take a while on production data, so give it a generous
> `--attempt-deadline` (e.g. 600s).

### 3. Verify

```bash
# Correct token → 200
curl -i -X POST https://baco.co.il/jobs/release-orders \
  -H "X-Scheduler-Token: <secret>"

# Missing/wrong token → 403 ; token not configured on the server → 503
```

Then trigger once from Cloud Scheduler (**Run now**) and confirm a `200` in the
job's logs.

---

## Notes

- **"Run time of job X was missed by …"** in the backend logs comes from the
  **in-process** scheduler (Option 1) when the process was suspended past the
  scheduled time — most commonly a **laptop sleeping**. On an always-on server
  it won't appear. With Option 2 the in-process scheduler is off, so these
  messages stop entirely.
- Both jobs are safe to run on demand: `rebuild` only deletes **free** slots
  (`taken IS NULL`) and recreates them, and `release_orders` only touches unpaid,
  non-finalized carts.
- Managers can also trigger a rebuild manually from the admin UI at any time.
