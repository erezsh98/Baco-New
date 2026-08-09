"""Record manager/admin management actions into the audit_log trail."""
import json

from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.user import User


def record(
    db: Session,
    user: User | None,
    action: str,
    summary: str,
    *,
    detail=None,
    club_id: int | None = None,
    club_name: str | None = None,
) -> None:
    """
    Add one audit row. Does NOT commit — it is flushed with the caller's
    transaction, so an action that later rolls back leaves no audit entry.
    Call this before the endpoint's db.commit().
    """
    user_id = None
    user_name = ""
    if user is not None:
        user_id = user.id
        user_name = f"{user.first_name} {user.last_name} <{user.username}>".strip()

    db.add(AuditLog(
        user_id=user_id,
        user_name=user_name,
        club_id=club_id,
        club_name=club_name,
        action=action,
        summary=(summary or "")[:512],
        detail=json.dumps(detail, ensure_ascii=False) if detail is not None else None,
    ))
