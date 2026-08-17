from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.misc import Contact

router = APIRouter(prefix="/contact", tags=["contact"])

CONTACT_RECIPIENT = "servicebaco@gmail.com"   # all צור קשר messages go here


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

    # Contact-us messages go to the BACO service inbox.
    from app.services.email import send_contact_email
    send_contact_email(c, CONTACT_RECIPIENT)

    return {"message": "Sent"}
