"""
Machine-triggered background jobs, for an external scheduler (e.g. GCP Cloud
Scheduler) to hit over HTTP — the same jobs the in-process APScheduler runs.

These are NOT user endpoints: they authenticate with a shared secret
(settings.scheduler_token) sent in the X-Scheduler-Token header, not a JWT.
If no token is configured the endpoints fail closed (503), so they can never
run unauthenticated by accident.

Wire in Cloud Scheduler:
  • POST https://baco.co.il/jobs/rebuild            — daily (mirrors the 01:00 cron)
  • POST https://baco.co.il/jobs/release-orders     — every 10 minutes
  with header  X-Scheduler-Token: <SCHEDULER_TOKEN>

When using Cloud Scheduler, set ENABLE_SCHEDULER=false so the in-process
scheduler doesn't run the same jobs a second time.
"""
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException

from app.config import settings
from app.services.scheduler import rebuild, release_uncompleted_orders

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _require_scheduler_token(
    x_scheduler_token: str | None = Header(default=None, alias="X-Scheduler-Token"),
) -> None:
    expected = settings.scheduler_token
    if not expected:
        # No secret configured → endpoints disabled (fail closed).
        raise HTTPException(status_code=503, detail="Scheduler jobs are not configured")
    if not x_scheduler_token or not hmac.compare_digest(x_scheduler_token, expected):
        raise HTTPException(status_code=403, detail="Invalid scheduler token")


@router.post("/rebuild", dependencies=[Depends(_require_scheduler_token)])
def job_rebuild():
    """Rebuild bookable availability for every club (same as the nightly cron)."""
    rebuild()  # db=None → manages its own session, all clubs
    return {"status": "ok", "job": "rebuild"}


@router.post("/release-orders", dependencies=[Depends(_require_scheduler_token)])
def job_release_orders():
    """Release slots stuck in a cart >10 min without payment (same as the interval job)."""
    release_uncompleted_orders()
    return {"status": "ok", "job": "release_orders"}
