from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.misc import Contact

router = APIRouter(prefix="/contact", tags=["contact"])


class ContactIn(BaseModel):
    name: str
    email: EmailStr
    message: str


@router.post("")
def submit_contact(data: ContactIn, db: Session = Depends(get_db)):
    parts = data.name.split(" ", 1)
    c = Contact(
        first_name=parts[0],
        last_name=parts[1] if len(parts) > 1 else "",
        email=data.email,
        content=data.message,
        type_of="web",
    )
    db.add(c)
    db.commit()

    # Mirror ContactController.save: email the club (fall back to the system
    # address when the form has no club attached).
    from app.config import settings
    from app.services.email import send_contact_email
    club_email = c.club.email if (c.club and c.club.email) else settings.email_from
    send_contact_email(c, club_email)

    return {"message": "Sent"}
