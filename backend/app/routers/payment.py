import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.config import settings
from app.database import get_db
from app.models.court import AvailableCourtSlot  # noqa: F401
from app.models.order import CourtOrder
from app.models.misc import PelecardErrorList
from app.models.user import User
from app.services.payment import build_pelecard_iframe

router = APIRouter(prefix="/payment", tags=["payment"])


# ---------------------------------------------------------------------------
# Helpers: Pelecard redirects the iframe to our callback with a fixed-width
# `result` string. We finalize, then break OUT of the iframe (window.top) back
# to the frontend (thank-you / search), since the callback lands inside the
# small payment iframe.
# ---------------------------------------------------------------------------
def _lower_params(request: Request) -> dict:
    return {k.lower(): v for k, v in request.query_params.items()}


def _redirect_top(path: str) -> HTMLResponse:
    url = settings.frontend_base_url.rstrip("/") + path
    return HTMLResponse(
        f"<!doctype html><meta charset='utf-8'>"
        f"<script>window.top.location.href={json.dumps(url)};</script>"
        f"<p style='font-family:sans-serif;text-align:center'>מעביר…</p>"
    )


def _error_top(desc: str) -> HTMLResponse:
    url = settings.frontend_base_url.rstrip("/") + "/search"
    return HTMLResponse(
        f"<!doctype html><meta charset='utf-8'>"
        f"<script>alert({json.dumps('התשלום נכשל: ' + desc)});"
        f"window.top.location.href={json.dumps(url)};</script>"
        f"<p style='font-family:sans-serif;text-align:center' dir='rtl'>התשלום נכשל: {desc}</p>"
    )


def _pelecard_error_desc(db: Session, result: str) -> str:
    code = (result or "")[:3]
    err = db.query(PelecardErrorList).filter(PelecardErrorList.error_code == code).first()
    return err.description if err and err.description else "התשלום נכשל"


class PelecardRequest(BaseModel):
    order_id: int   # CourtOrder.id


@router.post("/pelecard-iframe")
def get_pelecard_iframe(req: PelecardRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    order = db.query(CourtOrder).filter(
        CourtOrder.id == req.order_id, CourtOrder.user_id == current_user.id,
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    slot = order.slot
    if not slot:
        raise HTTPException(status_code=400, detail="Order has no slot")
    club = slot.rental_template.club
    url = build_pelecard_iframe(order.order_id, order.amount or 0, (club.u_name or "").strip(), 2)
    return {"iframe_url": url}


# ---------------------------------------------------------------------------
# Court-rental callbacks
# ---------------------------------------------------------------------------
@router.get("/pelecard-good")
async def pelecard_success(request: Request, db: Session = Depends(get_db)):
    q = _lower_params(request)
    result = q.get("result", "") or ""
    token = q.get("token")
    parmx = (q.get("parmx") or "").replace("baco-", "")

    # Approved when result starts with "000" and carries the full payload.
    if not (result.startswith("000") and len(result) >= 43):
        return _error_top(_pelecard_error_desc(db, result))

    try:
        order_id = int(parmx)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid order reference")

    amount_agorot = int(result[36:43].strip())        # legacy fixed-width slice
    approval = result[70:77] if len(result) >= 77 else ""

    order = db.query(CourtOrder).filter(CourtOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Verify Pelecard charged the expected amount (agorot) — reject tampering.
    if int(round((order.amount or 0) * 100)) != amount_agorot:
        return _error_top("סכום שגוי")

    order.is_final = "Y"
    order.approval_number = approval
    order.token = token
    db.commit()

    from app.services.email import send_booking_confirmation_cc
    send_booking_confirmation_cc(order)
    # TODO: gate/manager SMS once the SMS subsystem is wired
    return _redirect_top("/booking/thank-you")


@router.get("/pelecard-bad")
async def pelecard_failure(request: Request, db: Session = Depends(get_db)):
    q = _lower_params(request)
    return _error_top(_pelecard_error_desc(db, q.get("result", "")))


# ---------------------------------------------------------------------------
# Ticket-purchase callbacks
# ---------------------------------------------------------------------------
@router.get("/pelecard-ticket-good")
async def pelecard_ticket_success(request: Request, db: Session = Depends(get_db)):
    """Finalize a ticket purchase after approval (mirrors PelecardTicketGoodController)."""
    from datetime import date, timedelta
    from app.models.ticket import ClubCustomerPermittedTicket, CustomerTicket
    from app.routers.tickets import UNPAID_DATE

    q = _lower_params(request)
    result = q.get("result", "") or ""
    parmx = (q.get("parmx") or "").replace("baco-", "")

    if not (result.startswith("000") and len(result) >= 43):
        return _error_top(_pelecard_error_desc(db, result))

    try:
        ticket_id = int(parmx)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ticket reference")

    approval = result[70:77] if len(result) >= 77 else ""

    ticket = db.query(CustomerTicket).filter(
        CustomerTicket.id == ticket_id, CustomerTicket.end_date == UNPAID_DATE,
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Pending ticket not found")

    club_ticket = ticket.club_ticket
    if club_ticket and club_ticket.total_num_of_punches != -1000:
        end_date = date.today() + timedelta(days=365 * 10)
    else:
        permit = db.query(ClubCustomerPermittedTicket).filter(
            ClubCustomerPermittedTicket.user_id == ticket.user_id,
            ClubCustomerPermittedTicket.club_id == (club_ticket.club_id if club_ticket else None),
            ClubCustomerPermittedTicket.ticket_type == (club_ticket.ticket_type.strip() if club_ticket and club_ticket.ticket_type else None),
            ClubCustomerPermittedTicket.end_date > date.today(),
        ).first()
        end_date = permit.end_date if permit else date.today() + timedelta(days=365)

    ticket.end_date = end_date
    ticket.approval_number = approval
    ticket.ticket_cost = club_ticket.ticket_cost if club_ticket else None
    db.commit()

    from app.services.email import send_ticket_purchase_confirmation
    send_ticket_purchase_confirmation(ticket)
    return _redirect_top("/tickets")


@router.get("/pelecard-ticket-bad")
async def pelecard_ticket_failure(request: Request, db: Session = Depends(get_db)):
    q = _lower_params(request)
    return _error_top(_pelecard_error_desc(db, q.get("result", "")))
