from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.types import Date  # DATE column tolerant of production's DATETIME


class CourtOrder(Base):
    __tablename__ = "court_order"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("user.id"))
    order_id = Column(Integer, unique=True)          # random unique ID shown to user
    is_final = Column(String(1), nullable=True)      # Y=confirmed, C=cancelled, null=pending
    order_date = Column(Date)
    approval_number = Column(String(255), nullable=True)  # Pelecard approval
    amount = Column(Float, nullable=True)
    customer_ticket_id = Column(Integer, ForeignKey("customer_ticket.id"), nullable=True)
    token = Column(String(255), nullable=True)       # Pelecard token
    description = Column(String(500), nullable=True)

    user = relationship("User", back_populates="orders")
    slot = relationship("AvailableCourtSlot", back_populates="order", uselist=False)
    customer_ticket = relationship("CustomerTicket")


class UsersCart(Base):
    __tablename__ = "users_cart"

    id = Column(Integer, primary_key=True)
    # Python attribute stays available_court_slot_id; the real production column is
    # "available_courts_search_id" (GORM named it from the legacy UsersCart domain's
    # `availableCourtsSearch` property, before the entity was renamed AvailableCourtSlot).
    available_court_slot_id = Column("available_courts_search_id", Integer, ForeignKey("available_courts_search.id"))
    user_id = Column(Integer, ForeignKey("user.id"))

    slot = relationship("AvailableCourtSlot")
    user = relationship("User")


class RentalLog(Base):
    __tablename__ = "rental_log"

    id = Column(Integer, primary_key=True)
    club_id = Column(Integer, ForeignKey("club.id"))
    date = Column(Date)
    start_hour = Column(Integer)
    end_hour = Column(Integer)
    court_number = Column(Integer)
    user_id = Column(Integer, ForeignKey("user.id"))
    transaction_id = Column(Integer)
    status = Column(String(255))

    club = relationship("Club")
    user = relationship("User")
