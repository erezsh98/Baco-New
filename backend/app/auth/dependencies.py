from fastapi import Depends, HTTPException, status
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


def require_admin(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    is_admin = (
        db.query(UserRole)
        .join(Role)
        .filter(UserRole.user_id == current_user.id, Role.authority == "ROLE_ADMIN")
        .first()
    )
    if not is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_club_manager(
    current_user: User = Depends(require_admin), db: Session = Depends(get_db)
) -> ClubManager:
    """A user who is both ROLE_ADMIN and listed in club_managers. Returns their
    ClubManager row so endpoints can scope to `manager.club_id`."""
    manager = db.query(ClubManager).filter(ClubManager.user_id == current_user.id).first()
    if not manager:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a club manager")
    return manager
