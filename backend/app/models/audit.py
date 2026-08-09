from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.database import Base


class AuditLog(Base):
    """
    Append-only trail of manager/admin management actions. User and club names
    are denormalized so a historical entry stays readable even if the user or
    club is later renamed or removed. Never updated or deleted by app code.
    """
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, nullable=False, default=datetime.now)  # server local time
    user_id = Column(Integer, ForeignKey("user.id"), nullable=True)
    user_name = Column(String(255), nullable=False, default="")
    club_id = Column(Integer, nullable=True)      # null = global action (e.g. full rebuild)
    club_name = Column(String(255), nullable=True)
    action = Column(String(64), nullable=False)   # stable code, e.g. "schedule.save"
    summary = Column(String(512), nullable=False, default="")  # human Hebrew one-liner
    detail = Column(Text, nullable=True)          # JSON blob with the specifics
