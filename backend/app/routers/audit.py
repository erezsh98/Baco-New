"""
Read-only manager/admin action trail.

Access: a user who manages one or more clubs (has club_managers rows) sees only
those clubs' entries; a pure admin (manages no club) sees everything.
"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.auth.dependencies import require_admin
from app.database import get_db
from app.models.audit import AuditLog
from app.models.club import ClubManager
from app.models.user import User

router = APIRouter(prefix="/admin/audit", tags=["audit"])


@router.get("")
def list_audit(
    from_date: date | None = None,
    to_date: date | None = None,
    action: str | None = None,
    user_id: int | None = None,
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    managed = [m.club_id for m in db.query(ClubManager).filter(ClubManager.user_id == admin.id).all()]

    q = db.query(AuditLog)
    # Club managers are scoped to their own club(s); a pure admin sees all.
    if managed:
        q = q.filter(AuditLog.club_id.in_(managed))
    if from_date:
        q = q.filter(AuditLog.created_at >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        q = q.filter(AuditLog.created_at < datetime.combine(to_date + timedelta(days=1), datetime.min.time()))
    if action:
        q = q.filter(AuditLog.action == action)
    if user_id:
        q = q.filter(AuditLog.user_id == user_id)

    rows = q.order_by(AuditLog.created_at.desc()).limit(limit).all()
    return {
        "scoped_to_clubs": managed or None,   # null = sees all clubs
        "rows": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "user_id": r.user_id,
                "user_name": r.user_name,
                "club_id": r.club_id,
                "club_name": r.club_name,
                "action": r.action,
                "summary": r.summary,
                "detail": r.detail,
            }
            for r in rows
        ],
    }
