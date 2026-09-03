from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.types import Date  # DATE column tolerant of production's DATETIME


class ResetPassword(Base):
    __tablename__ = "reset_password"

    id = Column(Integer, primary_key=True)
    username = Column(String(255))
    token = Column(String(255))
    date_created = Column(Date)


class Contact(Base):
    __tablename__ = "contact"

    id = Column(Integer, primary_key=True)
    first_name = Column(String(255))
    last_name = Column(String(255))
    phone_number = Column(String(255), nullable=True)
    email = Column(String(255))
    contact_type = Column(String(255), nullable=True)
    content = Column(String(2000), nullable=True)
    type_of = Column(String(255))
    # Global "צור קשר" form has no club (messages go to the BACO inbox), so this
    # is nullable — the legacy schema had it NOT NULL (see migration 003).
    club_id = Column(Integer, ForeignKey("club.id"), nullable=True)

    club = relationship("Club")


class PelecardErrorList(Base):
    __tablename__ = "pelecard_error_list"

    id = Column(Integer, primary_key=True)
    description = Column(String(500))
    error_code = Column(String(10))
