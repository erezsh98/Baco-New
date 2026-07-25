from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, require_admin
from typing import Optional
from app.database import get_db
from app.models.club import Area, Club
from app.models.user import User

router = APIRouter(prefix="/clubs", tags=["clubs"])


class AreaOut(BaseModel):
    id: int
    area_code: str | None
    description: str | None

    class Config:
        from_attributes = True


class ClubOut(BaseModel):
    id: int
    club_name: str | None
    area_id: int | None
    contact_phone: str | None
    description: str | None
    num_of_courts: int | None

    class Config:
        from_attributes = True


@router.get("/areas", response_model=list[AreaOut])
def list_areas(db: Session = Depends(get_db)):
    return db.query(Area).all()


@router.get("", response_model=list[ClubOut])
def list_clubs(area_id: int | None = None, db: Session = Depends(get_db)):
    q = db.query(Club)
    if area_id:
        q = q.filter(Club.area_id == area_id)
    return q.all()


@router.get("/{club_id}", response_model=ClubOut)
def get_club(club_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from fastapi import HTTPException
    club = db.query(Club).filter(Club.id == club_id).first()
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")
    return club
