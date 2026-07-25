from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.database import get_db
from app.models.court import AvailableCourtSlot
from app.models.order import CourtOrder
from app.models.misc import PelecardErrorList
from app.models.user import User
from app.services.payment import build_pelecard_iframe

router = APIRouter(prefix="/payment", tags=["payment"])


class PelecardRequest(BaseModel):
    order_id: int   # CourtOrder.id


@router.post("/pelecard-iframe")
def get_pelecard_iframe(req: PelecardRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    order = db.query(CourtOrder).filter(
        CourtOrder.id == req.order_id,
        CourtOrder.user_id == current_user.id,
    ).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    slot = order.slot
    if not slot:
        raise HTTPException(status_code=400, detail="Order has no slot")

    club = slot.rental_template.club
    iframe_xml = build_pelecard_iframe(
        order_id=order.order_id,
        amount_nis=order.amount or 0,
        club_uname=club.u_name or "",
        purchase_type=2,
    )
    return {"iframe_xml": iframe_xml}


@router.get("/pelecard-good")
async def pelecard_success(request: Request, db: Session = Depends(get_db)):
    params = dict(request.query_params)
    parm_x = params.get("parmx", "")
    result_code = params.get("result", "")
    approval = params.get("confirmationkey", "")
    token = params.get("token", "")

    order_id_str = parm_x.replace("baco-", "")
    try:
        order_id = int(order_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid order reference")

    if result_code != "000":
        raise HTTPException(status_code=400, detail="Payment not approved")

    order = db.query(CourtOrder).filter(CourtOrder.order_id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.is_final = "Y"
    order.approval_number = approval
    order.token = token
    db.commit()

    from app.services.email import send_booking_confirmation_cc
    send_booking_confirmation_cc(order)
    # TODO: send confirmation SMS (gate/manager) once the SMS subsystem is wired
    return {"message": "Payment confirmed", "order_id": order_id}


@router.get("/pelecard-bad")
async def pelecard_failure(request: Request, db: Session = Depends(get_db)):
    params = dict(request.query_params)
    result_code = params.get("result", "")
    error = db.query(PelecardErrorList).filter(PelecardErrorList.error_code == result_code).first()
    description = error.description if error else "Payment failed"
    return {"message": description, "error_code": result_code}


@router.get("/pelecard-ticket-good")
async def pelecard_ticket_success(request: Request, db: Session = Depends(get_db)):
    """
    Finalize a ticket purchase after Pelecard approves payment.
    Mirrors PelecardTicketGoodController: find the pending CustomerTicket
    (created with the UNPAID_DATE placeholder), verify the amount, then set
    the real end-date + approval number.
    """
    from datetime import date, timedelta
    from app.models.ticket import CustomerTicket, ClubTicket, ClubCustomerPermittedTicket
    from app.routers.tickets import UNPAID_DATE

    params = dict(request.query_params)
    parm_x = params.get("parmx", "")
    result_code = params.get("result", "")
    approval = params.get("confirmationkey", "")

    ticket_id_str = parm_x.replace("baco-", "")
    try:
        ticket_id = int(ticket_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ticket reference")

    if result_code != "000":
        raise HTTPException(status_code=400, detail="Payment not approved")

    ticket = db.query(CustomerTicket).filter(
        CustomerTicket.id == ticket_id,
        CustomerTicket.end_date == UNPAID_DATE,
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Pending ticket not found")

    club_ticket = ticket.club_ticket

    # Determine the real end-date: 10 years for punch cards, or the
    # subscription permission's end-date for unlimited (-1000) tickets.
    if club_ticket and club_ticket.total_num_of_punches != -1000:
        end_date = date.today() + timedelta(days=365 * 10)
    else:
        permit = db.query(ClubCustomerPermittedTicket).filter(
            ClubCustomerPermittedTicket.user_id == ticket.user_id,
            ClubCustomerPermittedTicket.club_id == club_ticket.club_id if club_ticket else None,
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
    return {"message": "Ticket purchase confirmed", "customer_ticket_id": ticket.id}


@router.get("/pelecard-ticket-bad")
async def pelecard_ticket_failure(request: Request, db: Session = Depends(get_db)):
    return await pelecard_failure(request, db)
