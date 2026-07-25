from sqlalchemy import Boolean, Column, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Role(Base):
    __tablename__ = "role"

    id = Column(Integer, primary_key=True)
    authority = Column(String(255), unique=True, nullable=False)


class User(Base):
    __tablename__ = "user"

    id = Column(Integer, primary_key=True)
    username = Column(String(255), unique=True, nullable=False)  # email address
    password = Column(String(255), nullable=False)
    first_name = Column(String(255), nullable=False)
    last_name = Column(String(255), nullable=False)
    phone_number = Column(String(255))
    enabled = Column(Boolean, default=True)
    account_expired = Column(Boolean, default=False)
    account_locked = Column(Boolean, default=False)
    password_expired = Column(Boolean, default=False)

    roles = relationship("UserRole", back_populates="user")
    orders = relationship("CourtOrder", back_populates="user")
    tickets = relationship("CustomerTicket", back_populates="user")


class UserRole(Base):
    __tablename__ = "user_role"

    user_id = Column(Integer, ForeignKey("user.id"), primary_key=True)
    role_id = Column(Integer, ForeignKey("role.id"), primary_key=True)

    user = relationship("User", back_populates="roles")
    role = relationship("Role")
