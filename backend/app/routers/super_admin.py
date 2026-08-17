"""
Super-admin (ROLE_SUPER_ADMIN) — a single, non-club-scoped user who configures
the system that club managers then operate:

  • Clubs            — create / edit club details & policies
  • Club managers    — assign / remove which users manage which clubs
  • Tickets & groups — punch cards AND permission/pricing groups (both are
                       club_ticket rows), incl. their active-time windows

All endpoints require ROLE_SUPER_ADMIN. No schema changes — reuses existing tables.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.dependencies import require_super_admin
from app.database import get_db
from app.models.club import Address, Area, Club, ClubManager
from app.models.court import AvailableCourtSlot, RentalTemplate
from app.models.order import CourtOrder  # noqa: F401 (relationship targets)
from app.models.ticket import ClubTicket, CustomerTicket, TicketActiveTime
from app.models.user import Role, User, UserRole
from app.services import audit
from app.services.scheduler import rebuild

router = APIRouter(prefix="/admin/super", tags=["super-admin"])


def _resolve_user(db: Session, ident: str) -> User | None:
    ident = (ident or "").strip()
    user = db.query(User).filter(User.username == ident).first()
    if user:
        return user
    digits = "".join(c for c in ident if c.isdigit())
    if not digits:
        return None
    user = db.query(User).filter(User.phone_number == digits).first()
    if user:
        return user
    # tolerate stored phone numbers with separators
    for u in db.query(User).filter(User.phone_number.isnot(None)).all():
        if "".join(c for c in (u.phone_number or "") if c.isdigit()) == digits:
            return u
    return None


def _grant_role(db: Session, user_id: int, authority: str) -> None:
    role = db.query(Role).filter(Role.authority == authority).first()
    if not role:
        role = Role(authority=authority)
        db.add(role)
        db.flush()
    exists = db.query(UserRole).filter(UserRole.user_id == user_id, UserRole.role_id == role.id).first()
    if not exists:
        db.add(UserRole(user_id=user_id, role_id=role.id))


# ---------------------------------------------------------------------------
# Areas (lookup for the club form)
# ---------------------------------------------------------------------------
@router.get("/areas")
def list_areas(db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    return [{"id": a.id, "description": a.description} for a in db.query(Area).order_by(Area.description).all()]


# ---------------------------------------------------------------------------
# Clubs
# ---------------------------------------------------------------------------
class ClubIn(BaseModel):
    club_name: str
    area_id: int | None = None
    email: str | None = None
    num_of_courts: int | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    min_hour_for_cancel: int | None = None
    rent_threshold_days: int | None = None
    rental_threshold_hours: int | None = None
    admin_start_hour: int | None = None
    slot_window_days: int | None = None
    u_name: str | None = None            # Pelecard merchant username
    order_on_saturday: str | None = None  # "Y" or null
    street: str | None = None
    city: str | None = None


def _club_out(db: Session, c: Club) -> dict:
    area = db.query(Area).filter(Area.id == c.area_id).first() if c.area_id else None
    addr = db.query(Address).filter(Address.id == c.address_id).first() if c.address_id else None
    return {
        "id": c.id, "club_name": c.club_name, "area_id": c.area_id,
        "area_name": area.description if area else None,
        "email": c.email, "num_of_courts": c.num_of_courts,
        "contact_name": c.contact_name, "contact_phone": c.contact_phone,
        "min_hour_for_cancel": c.min_hour_for_cancel,
        "rent_threshold_days": c.rent_threshold_days,
        "rental_threshold_hours": c.rental_threshold_hours,
        "admin_start_hour": c.admin_start_hour,
        "slot_window_days": c.slot_window_days,
        "u_name": c.u_name, "order_on_saturday": c.order_on_saturday,
        "street": addr.street if addr else None, "city": addr.city if addr else None,
    }


def _apply_club(db: Session, c: Club, body: ClubIn) -> None:
    c.club_name = body.club_name
    c.area_id = body.area_id
    c.email = body.email
    c.num_of_courts = body.num_of_courts
    c.contact_name = body.contact_name
    c.contact_phone = body.contact_phone
    c.min_hour_for_cancel = body.min_hour_for_cancel
    c.rent_threshold_days = body.rent_threshold_days
    c.rental_threshold_hours = body.rental_threshold_hours
    c.admin_start_hour = body.admin_start_hour
    c.slot_window_days = body.slot_window_days
    c.u_name = body.u_name
    c.order_on_saturday = body.order_on_saturday
    # address (street/city) lives in its own table
    if body.street is not None or body.city is not None:
        addr = db.query(Address).filter(Address.id == c.address_id).first() if c.address_id else None
        if not addr:
            addr = Address()
            db.add(addr)
            db.flush()
            c.address_id = addr.id
        addr.street = body.street
        addr.city = body.city


@router.get("/clubs")
def list_clubs(db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    return [_club_out(db, c) for c in db.query(Club).order_by(Club.id).all()]


@router.post("/clubs", status_code=201)
def create_club(body: ClubIn, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    if not body.club_name.strip():
        raise HTTPException(status_code=400, detail="שם מועדון חובה")
    c = Club()
    _apply_club(db, c, body)
    db.add(c)
    db.flush()
    audit.record(db, su, "club.create", f"נוצר מועדון: {c.club_name}", club_id=c.id, club_name=c.club_name)
    db.commit()
    return _club_out(db, c)


@router.put("/clubs/{club_id}")
def update_club(club_id: int, body: ClubIn, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    c = db.query(Club).filter(Club.id == club_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="מועדון לא נמצא")
    _apply_club(db, c, body)
    audit.record(db, su, "club.update", f"עודכן מועדון: {c.club_name}", club_id=c.id, club_name=c.club_name)
    db.commit()
    return _club_out(db, c)


# ---------------------------------------------------------------------------
# Availability rebuild (all clubs or one)
# ---------------------------------------------------------------------------
class RebuildIn(BaseModel):
    club_id: int | None = None   # null = all clubs


@router.post("/rebuild")
def super_rebuild(body: RebuildIn, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    """Regenerate bookable availability for a specific club, or all clubs (club_id null)."""
    club = None
    if body.club_id is not None:
        club = db.query(Club).filter(Club.id == body.club_id).first()
        if not club:
            raise HTTPException(status_code=404, detail="מועדון לא נמצא")

    rebuild(db, club_id=body.club_id)

    # housekeeping: drop deactivated templates no longer referenced by any slot
    referenced = db.query(AvailableCourtSlot.rental_template_id).distinct()
    hk = db.query(RentalTemplate).filter(
        RentalTemplate.is_active == "N", RentalTemplate.id.notin_(referenced)
    )
    if body.club_id is not None:
        hk = hk.filter(RentalTemplate.club_id == body.club_id)
    hk.delete(synchronize_session=False)

    free_q = (
        db.query(func.count(AvailableCourtSlot.id))
        .join(RentalTemplate, AvailableCourtSlot.rental_template_id == RentalTemplate.id)
        .filter(AvailableCourtSlot.order_id.is_(None))
    )
    if body.club_id is not None:
        free_q = free_q.filter(RentalTemplate.club_id == body.club_id)
    free = free_q.scalar()

    scope = club.club_name if club else "כל המועדונים"
    audit.record(db, su, "availability.rebuild", f"עדכון זמינות ({scope}) — {free} סלוטים פנויים",
                 club_id=body.club_id, club_name=club.club_name if club else None,
                 detail={"scope": scope, "free_slots": free})
    db.commit()
    return {"message": f"הזמינות עודכנה עבור {scope} — {free} סלוטים פנויים."}


# ---------------------------------------------------------------------------
# Club managers
# ---------------------------------------------------------------------------
class ManagerIn(BaseModel):
    email_or_phone: str


@router.get("/clubs/{club_id}/managers")
def list_managers(club_id: int, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    rows = db.query(ClubManager).filter(ClubManager.club_id == club_id).all()
    out = []
    for m in rows:
        u = m.user
        if not u:
            continue
        out.append({
            "id": m.id, "user_id": u.id,
            "user_name": f"{u.first_name} {u.last_name}",
            "email": u.username, "phone": u.phone_number or "",
        })
    return out


@router.post("/clubs/{club_id}/managers", status_code=201)
def add_manager(club_id: int, body: ManagerIn, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    club = db.query(Club).filter(Club.id == club_id).first()
    if not club:
        raise HTTPException(status_code=404, detail="מועדון לא נמצא")
    user = _resolve_user(db, body.email_or_phone)
    if not user:
        raise HTTPException(status_code=404, detail="לא נמצא משתמש")
    existing = db.query(ClubManager).filter(
        ClubManager.club_id == club_id, ClubManager.user_id == user.id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="המשתמש כבר מנהל של מועדון זה")

    db.add(ClubManager(club_id=club_id, user_id=user.id))
    _grant_role(db, user.id, "ROLE_ADMIN")   # a manager must be an admin
    audit.record(db, su, "manager.add",
                 f"נוסף מנהל: {user.first_name} {user.last_name} → {club.club_name}",
                 club_id=club_id, club_name=club.club_name,
                 detail={"user_id": user.id, "email": user.username})
    db.commit()
    return {"message": f"{user.first_name} {user.last_name} מונה כמנהל של {club.club_name}"}


@router.delete("/managers/{manager_id}")
def remove_manager(manager_id: int, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    m = db.query(ClubManager).filter(ClubManager.id == manager_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="לא נמצא")
    club = m.club
    u = m.user
    audit.record(db, su, "manager.remove",
                 f"הוסר מנהל: {u.first_name if u else ''} {u.last_name if u else ''} מ{club.club_name if club else ''}",
                 club_id=m.club_id, club_name=club.club_name if club else None,
                 detail={"user_id": m.user_id})
    db.delete(m)
    # NOTE: ROLE_ADMIN is intentionally left in place — the user may manage other
    # clubs; require_club_manager already 403s once they manage none.
    db.commit()
    return {"message": "המנהל הוסר"}


# ---------------------------------------------------------------------------
# Tickets & groups (club_ticket)
# ---------------------------------------------------------------------------
class ActiveTimeIn(BaseModel):
    day_of_week: int   # 1=Sun .. 7=Sat
    start_hour: int
    end_hour: int


class TicketIn(BaseModel):
    description: str | None = None
    ticket_type: str | None = None       # numeric (punch card) | מנוי | חבר מועדון | זיכוי ...
    ticket_cost: float | None = None
    total_num_of_punches: int | None = None   # -1000 = unlimited
    end_date: date | None = None
    max_orders_per_day: int | None = -1
    active_times: list[ActiveTimeIn] = []


def _ticket_out(t: ClubTicket) -> dict:
    return {
        "id": t.id, "club_id": t.club_id, "description": t.description,
        "ticket_type": t.ticket_type, "ticket_cost": t.ticket_cost,
        "total_num_of_punches": t.total_num_of_punches, "end_date": str(t.end_date) if t.end_date else None,
        "max_orders_per_day": t.max_orders_per_day,
        "active_times": [
            {"day_of_week": a.day_of_week, "start_hour": a.start_hour, "end_hour": a.end_hour}
            for a in t.active_times
        ],
    }


def _apply_active_times(db: Session, t: ClubTicket, times: list[ActiveTimeIn]) -> None:
    db.query(TicketActiveTime).filter(TicketActiveTime.club_ticket_id == t.id).delete(synchronize_session=False)
    for a in times:
        db.add(TicketActiveTime(club_ticket_id=t.id, day_of_week=a.day_of_week,
                                start_hour=a.start_hour, end_hour=a.end_hour))


@router.get("/clubs/{club_id}/tickets")
def list_tickets(club_id: int, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    return [_ticket_out(t) for t in db.query(ClubTicket).filter(ClubTicket.club_id == club_id).order_by(ClubTicket.id).all()]


@router.post("/clubs/{club_id}/tickets", status_code=201)
def create_ticket(club_id: int, body: TicketIn, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    club = db.query(Club).filter(Club.id == club_id).first()
    if not club:
        raise HTTPException(status_code=404, detail="מועדון לא נמצא")
    t = ClubTicket(
        club_id=club_id, description=body.description, ticket_type=(body.ticket_type or "").strip() or None,
        ticket_cost=body.ticket_cost, total_num_of_punches=body.total_num_of_punches,
        end_date=body.end_date, max_orders_per_day=body.max_orders_per_day if body.max_orders_per_day is not None else -1,
    )
    db.add(t)
    db.flush()
    _apply_active_times(db, t, body.active_times)
    audit.record(db, su, "ticket.create",
                 f"נוצרה כרטיסייה/קבוצה: {body.description or body.ticket_type} — {club.club_name}",
                 club_id=club_id, club_name=club.club_name)
    db.commit()
    return _ticket_out(t)


@router.put("/tickets/{ticket_id}")
def update_ticket(ticket_id: int, body: TicketIn, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    t = db.query(ClubTicket).filter(ClubTicket.id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="כרטיסייה לא נמצאה")
    t.description = body.description
    t.ticket_type = (body.ticket_type or "").strip() or None
    t.ticket_cost = body.ticket_cost
    t.total_num_of_punches = body.total_num_of_punches
    t.end_date = body.end_date
    t.max_orders_per_day = body.max_orders_per_day if body.max_orders_per_day is not None else -1
    _apply_active_times(db, t, body.active_times)
    club = t.club
    audit.record(db, su, "ticket.update",
                 f"עודכנה כרטיסייה/קבוצה: {body.description or body.ticket_type} — {club.club_name if club else ''}",
                 club_id=t.club_id, club_name=club.club_name if club else None)
    db.commit()
    return _ticket_out(t)


@router.delete("/tickets/{ticket_id}")
def delete_ticket(ticket_id: int, db: Session = Depends(get_db), su: User = Depends(require_super_admin)):
    t = db.query(ClubTicket).filter(ClubTicket.id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="כרטיסייה לא נמצאה")
    in_use = db.query(CustomerTicket).filter(CustomerTicket.club_ticket_id == ticket_id).first()
    if in_use:
        raise HTTPException(status_code=400, detail="לא ניתן למחוק — קיימות כרטיסיות לקוח שמשתמשות בהגדרה זו")
    db.query(TicketActiveTime).filter(TicketActiveTime.club_ticket_id == ticket_id).delete(synchronize_session=False)
    db.delete(t)
    db.commit()
    return {"message": "נמחק"}
