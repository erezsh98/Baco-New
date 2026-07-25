from sqlalchemy import Column, Date, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class ClubTicket(Base):
    __tablename__ = "club_ticket"

    id = Column(Integer, primary_key=True)
    club_id = Column(Integer, ForeignKey("club.id"))
    ticket_cost = Column(Float)
    description = Column(String(500))
    end_date = Column(Date)
    total_num_of_punches = Column(Integer)   # -1000 = unlimited
    ticket_type = Column(String(255))        # מנוי / זיכוי
    max_orders_per_day = Column(Integer, default=-1)

    club = relationship("Club", back_populates="club_tickets")
    active_times = relationship("TicketActiveTime", back_populates="club_ticket")
    customer_tickets = relationship("CustomerTicket", back_populates="club_ticket")


class CustomerTicket(Base):
    __tablename__ = "customer_ticket"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("user.id"))
    club_ticket_id = Column(Integer, ForeignKey("club_ticket.id"))
    cur_num_of_punches = Column(Integer)
    end_date = Column(Date)
    approval_number = Column(String(255), nullable=True)
    ticket_cost = Column(Float, nullable=True)

    user = relationship("User", back_populates="tickets")
    club_ticket = relationship("ClubTicket", back_populates="customer_tickets")


class TicketActiveTime(Base):
    __tablename__ = "ticket_active_time"

    id = Column(Integer, primary_key=True)
    club_ticket_id = Column(Integer, ForeignKey("club_ticket.id"))
    day_of_week = Column(Integer)   # 1=Sunday, 7=Saturday
    start_hour = Column(Integer)
    end_hour = Column(Integer)

    club_ticket = relationship("ClubTicket", back_populates="active_times")


class ClubCustomerPermittedTicket(Base):
    __tablename__ = "club_customer_permitted_ticket"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=True)
    club_id = Column(Integer, ForeignKey("club.id"))
    ticket_type = Column(String(255))
    end_date = Column(Date, nullable=True)

    user = relationship("User")
    club = relationship("Club")
