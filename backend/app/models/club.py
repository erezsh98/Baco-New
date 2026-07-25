from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Area(Base):
    __tablename__ = "area"

    id = Column(Integer, primary_key=True)
    area_code = Column(String(255))
    description = Column(String(255))

    clubs = relationship("Club", back_populates="area")


class Address(Base):
    __tablename__ = "address"

    id = Column(Integer, primary_key=True)
    street = Column(String(255))
    city = Column(String(255))


class Club(Base):
    __tablename__ = "club"

    id = Column(Integer, primary_key=True)
    club_name = Column(String(255))
    area_id = Column(Integer, ForeignKey("area.id"))
    address_id = Column(Integer, ForeignKey("address.id"))
    email = Column(String(255))
    num_of_courts = Column(Integer)
    contact_phone = Column(String(255))
    contact_name = Column(String(255))
    min_hour_for_cancel = Column(Integer)
    description = Column(String(1000))
    routing_number = Column(Integer)
    admin_start_hour = Column(Integer)
    rent_threshold_days = Column(Integer)
    rental_threshold_hours = Column(Integer)
    u_name = Column(String(255))          # Pelecard merchant username
    sms_to_manager = Column(String(1))    # Y/N
    sms_to_gate = Column(String(1))       # Y/N
    gate_phone = Column(String(255))
    gate_pass = Column(String(255))
    order_on_saturday = Column(String(1))

    area = relationship("Area", back_populates="clubs")
    address = relationship("Address")
    rental_templates = relationship("RentalTemplate", back_populates="club")
    managers = relationship("ClubManager", back_populates="club")
    club_tickets = relationship("ClubTicket", back_populates="club")


class ClubManager(Base):
    __tablename__ = "club_managers"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("user.id"))
    club_id = Column(Integer, ForeignKey("club.id"))

    club = relationship("Club", back_populates="managers")
    user = relationship("User")


class FixedGatePhoneNumber(Base):
    __tablename__ = "fixed_gate_phone_numbers"

    id = Column(Integer, primary_key=True)
    club_id = Column(Integer, ForeignKey("club.id"))
    phone_number = Column(String(255))

    club = relationship("Club")
