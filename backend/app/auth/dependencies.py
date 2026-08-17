from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.auth.jwt import decode_token
from app.database import get_db
from app.models.club import ClubManager
from app.models.user import User, UserRole, Role

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def get_current_user_optional(token: str | None = Depends(oauth2_scheme_optional), db: Session = Depends(get_db)) -> User | None:
    """Like get_current_user but never raises — returns None for anonymous requests.
    Used by endpoints that work logged-out but personalize when a token is present."""
    if not token:
        return None
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if user_id is None:
            return None
        user_id = int(user_id)
    except JWTError:
        return None
    return db.query(User).filter(User.id == user_id, User.enabled == True).first()


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_error
        user_id = int(user_id)
    except JWTError:
        raise credentials_error

    user = db.query(User).filter(User.id == user_id, User.enabled == True).first()
    if not user:
        raise credentials_error
    return user


SUPER_ADMIN_ROLE = "ROLE_SUPER_ADMIN"


def has_role(db: Session, user_id: int, authority: str) -> bool:
    return (
        db.query(UserRole)
        .join(Role)
        .filter(UserRole.user_id == user_id, Role.authority == authority)
        .first()
        is not None
    )


def require_admin(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    if not has_role(db, current_user.id, "ROLE_ADMIN"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_super_admin(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """The single system super-user. Not club-scoped; manages clubs, managers and
    club tickets/groups across all clubs. Independent of ROLE_ADMIN."""
    if not has_role(db, current_user.id, SUPER_ADMIN_ROLE):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return current_user


def require_club_manager(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    x_club_id: int | None = Header(default=None, alias="X-Club-Id"),
) -> ClubManager:
    """
    A user who is ROLE_ADMIN and listed in club_managers. Returns the ClubManager
    row for the ACTIVE club, so endpoints can keep scoping to `manager.club_id`.

    A manager may manage several clubs; the frontend picks one via the X-Club-Id
    header. With no header (e.g. single-club managers) the first managed club is
    used. A header naming a club the user does not manage is rejected (403).
    """
    managed = db.query(ClubManager).filter(ClubManager.user_id == current_user.id).all()
    if not managed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a club manager")
    if x_club_id is not None:
        chosen = next((m for m in managed if m.club_id == x_club_id), None)
        if chosen is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a manager of this club")
        return chosen
    return managed[0]
