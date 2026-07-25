import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.auth.jwt import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models.user import Role, User, UserRole

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    last_name: str
    phone_number: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.enabled:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
    token = create_access_token({"sub": str(user.id)})
    return TokenResponse(access_token=token)


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == req.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        username=req.email,
        password=hash_password(req.password),
        first_name=req.first_name,
        last_name=req.last_name,
        phone_number=req.phone_number,
    )
    db.add(user)
    db.flush()

    role = db.query(Role).filter(Role.authority == "ROLE_USER").first()
    if not role:
        role = Role(authority="ROLE_USER")
        db.add(role)
        db.flush()

    db.add(UserRole(user_id=user.id, role_id=role.id))
    db.commit()
    return {"message": "Registration successful"}


@router.post("/reset-password")
def request_reset(email: str, db: Session = Depends(get_db)):
    from app.models.misc import ResetPassword
    user = db.query(User).filter(User.username == email).first()
    if user:
        token = uuid.uuid4().hex
        db.add(ResetPassword(username=email, token=token, date_created=date.today()))
        db.commit()
        # TODO: send email via services/email.py
    return {"message": "If the email exists, a reset link has been sent"}


@router.get("/reset-password/{token}")
def reset_password(token: str, new_password: str, db: Session = Depends(get_db)):
    from app.models.misc import ResetPassword
    record = db.query(ResetPassword).filter(ResetPassword.token == token).first()
    if not record:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    user = db.query(User).filter(User.username == record.username).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    user.password = hash_password(new_password)
    db.delete(record)
    db.commit()
    return {"message": "Password updated"}


class ResetRequest(BaseModel):
    email: EmailStr


class ResetConfirm(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password/request")
def request_reset_email(body: ResetRequest, db: Session = Depends(get_db)):
    """Generate a reset token and email the user a reset link.
    Mirrors ResetPasswordController.save + sendEmail. (Endpoint used by the frontend.)"""
    from app.models.misc import ResetPassword
    from app.config import settings
    from app.services.email import send_reset_password_email

    user = db.query(User).filter(User.username == body.email).first()
    if user:
        token = uuid.uuid4().hex
        db.add(ResetPassword(username=body.email, token=token, date_created=date.today()))
        db.commit()
        url = f"{settings.frontend_base_url}/reset-password?token={token}"
        send_reset_password_email(user, url)
    # Do not reveal whether the email exists.
    return {"message": "If the email exists, a reset link has been sent"}


@router.post("/reset-password/confirm")
def confirm_reset(body: ResetConfirm, db: Session = Depends(get_db)):
    """Set a new password from a reset token. (Endpoint used by the frontend.)"""
    from app.models.misc import ResetPassword

    record = db.query(ResetPassword).filter(ResetPassword.token == body.token).first()
    if not record:
        raise HTTPException(status_code=400, detail="קישור לא תקין או שפג תוקפו")
    user = db.query(User).filter(User.username == record.username).first()
    if not user:
        raise HTTPException(status_code=400, detail="משתמש לא נמצא")

    user.password = hash_password(body.new_password)
    db.delete(record)
    db.commit()
    return {"message": "Password updated"}
