from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.types import Date  # DATE column tolerant of production's DATETIME


class RentalTemplate(Base):
    # Production (legacy Grails) table is misspelled "rental_tamplate" — keep it so
    # the app runs against the existing production DB.
    __tablename__ = "rental_tamplate"

    id = Column(Integer, primary_key=True)
    club_id = Column(Integer, ForeignKey("club.id"))
    start_effective_date = Column(Date)
    end_effective_date = Column(Date)
    days_str = Column(String(255))   # comma-separated day numbers 1-7 (Sun-Sat)
    from_hour = Column(Integer)
    end_hour = Column(Integer)
    court_number = Column(Integer)
    surface_type = Column(String(255))
    member_price = Column(Float)          # DOUBLE in the DB — supports decimals (e.g. 16.5)
    non_member_price = Column(Float)
    is_active = Column(String(1), default="Y")  # Y/N
    # Python attribute stays minutes_offset; DB column is the prod typo "minuts_offset".
    minutes_offset = Column("minuts_offset", Integer, default=0)
    for_member = Column(String(1))

    club = relationship("Club", back_populates="rental_templates")
    slots = relationship("AvailableCourtSlot", back_populates="rental_template")


class AvailableCourtSlot(Base):
    __tablename__ = "available_courts_search"

    id = Column(Integer, primary_key=True)
    # Python attribute stays rental_template_id; DB column/FK use the prod typo.
    rental_template_id = Column("rental_tamplate_id", Integer, ForeignKey("rental_tamplate.id"))
    hour = Column(Integer)
    curdate = Column(Date)
    taken = Column(DateTime, nullable=True)
    is_holiday = Column(String(1), nullable=True)  # Y or null
    order_id = Column(Integer, ForeignKey("court_order.id"), nullable=True)

    rental_template = relationship("RentalTemplate", back_populates="slots")
    order = relationship("CourtOrder", back_populates="slot")


class CourtLockDate(Base):
    __tablename__ = "court_lock_dates"

    id = Column(Integer, primary_key=True)
    club_id = Column(Integer, ForeignKey("club.id"))
    day_of_week = Column(Integer)
    from_hour = Column(Integer)
    to_hour = Column(Integer)

    club = relationship("Club")


class HolidayDate(Base):
    __tablename__ = "holiday_dates"

    id = Column(Integer, primary_key=True)
    club_id = Column(Integer, ForeignKey("club.id"))
    court_number = Column(Integer, nullable=True)  # NULL = all courts in the club
    start_date = Column(Date)
    end_date = Column(Date)
    start_hour = Column(Integer)
    end_hour = Column(Integer)

    club = relationship("Club")


class HolidayOverwrite(Base):
    __tablename__ = "holiday_overwrite"

    id = Column(Integer, primary_key=True)
    club_id = Column(Integer, ForeignKey("club.id"))
    date = Column(Date)
    start_hour = Column(Integer)
    end_hour = Column(Integer)

    club = relationship("Club")
