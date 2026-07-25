from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.jwt import hash_password
from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])


class UserOut(BaseModel):
    id: int
    username: str
    first_name: str
    last_name: str
    phone_number: str | None
    roles: list[str] = []
    is_admin: bool = False

    class Config:
        from_attributes = True


class UpdateUserRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    phone_number: str | None = None
    password: str | None = None


def _user_out(user: User, db: Session) -> UserOut:
    from app.models.user import Role, UserRole
    roles = (
        db.query(Role.authority)
        .join(UserRole, UserRole.role_id == Role.id)
        .filter(UserRole.user_id == user.id)
        .all()
    )
    role_names = [r[0] for r in roles]
    return UserOut(
        id=user.id,
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        phone_number=user.phone_number,
        roles=role_names,
        is_admin="ROLE_ADMIN" in role_names,
    )


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _user_out(current_user, db)


@router.put("/me", response_model=UserOut)
def update_me(req: UpdateUserRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.first_name:
        current_user.first_name = req.first_name
    if req.last_name:
        current_user.last_name = req.last_name
    if req.phone_number:
        current_user.phone_number = req.phone_number
    if req.password:
        current_user.password = hash_password(req.password)
    db.commit()
    db.refresh(current_user)
    return _user_out(current_user, db)
