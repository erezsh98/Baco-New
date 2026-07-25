from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class RentalTemplate(Base):
    __tablename__ = "rental_template"

    id = Column(Integer, primary_key=True)
    club_id = Column(Integer, ForeignKey("club.id"))
    start_effective_date = Column(Date)
    end_effective_date = Column(Date)
    days_str = Column(String(255))   # comma-separated day numbers 1-7 (Sun-Sat)
    from_hour = Column(Integer)
    end_hour = Column(Integer)
    court_number = Column(Integer)
    surface_type = Column(String(255))
    member_price = Column(Integer)
    non_member_price = Column(Integer)
    is_active = Column(String(1), default="Y")  # Y/N
    minutes_offset = Column(Integer, default=0)
    for_member = Column(String(1))

    club = relationship("Club", back_populates="rental_templates")
    slots = relationship("AvailableCourtSlot", back_populates="rental_template")


class AvailableCourtSlot(Base):
    __tablename__ = "available_courts_search"

    id = Column(Integer, primary_key=True)
    rental_template_id = Column(Integer, ForeignKey("rental_template.id"))
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
