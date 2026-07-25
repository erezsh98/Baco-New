"""
Email delivery — a faithful port of the legacy Grails mailService emails.

Every legacy mail was sent `from servicebaco@gmail.com` with `bcc
servicebaco@gmail.com`; the exact Hebrew subjects/bodies are reproduced here.
Transport is SMTP via the smtp_* settings (Gmail). Sending never raises: an
SMTP failure logs an error but must not break the booking/cancel/etc. flow.

Legacy sources (tennisLine/grails-app/controllers):
  - PelecardGoodController.sendEmail            -> send_booking_confirmation_cc
  - PaymentController.sendEmail                 -> send_booking_confirmation_ticket
  - PelecardTicketGoodController.sendEmail      -> send_ticket_purchase_confirmation
  - AvailableCourtsSearchController.sendCancelEmail -> send_cancellation_email
  - ClubCustomerPermittedTicketController.sendAddUserToGroupdEmail -> send_add_to_group_email
  - ResetPasswordController.sendEmail           -> send_reset_password_email
  - ContactController.save (inline mail)        -> send_contact_email
"""
import logging
import smtplib
from datetime import date
from email.message import EmailMessage

from app.config import settings

logger = logging.getLogger("tennisline.email")

CONTACT_LINK = "<a href='https://www.baco.co.il/contact/create'>צור קשר</a></p><br>"


def send_email(to: str, subject: str, html: str, text: str | None = None, bcc: str | None = None) -> bool:
    """Send one email (with a bcc, defaulting to the from-address like the legacy). Returns True on success."""
    if not to:
        return False
    if not settings.smtp_host:
        logger.warning("SMTP not configured (smtp_host empty); skipping email to %s", to)
        return False
    if bcc is None:
        bcc = settings.email_from  # legacy always bcc'd servicebaco@gmail.com (== from)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.email_from or settings.smtp_user
    msg["To"] = to
    if bcc:
        msg["Bcc"] = bcc  # smtplib.send_message uses this for delivery then strips it
    msg.set_content(text or "יש לצפות בהודעה זו בתצוגת HTML.")
    msg.add_alternative(html, subtype="html")

    try:
        if settings.smtp_port == 465:
            smtp = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20)
        else:
            smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
        with smtp:
            if settings.smtp_port != 465:
                smtp.ehlo()
                smtp.starttls()
                smtp.ehlo()
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        logger.info("email sent to %s (%s)", to, subject)
        return True
    except Exception as exc:  # never let an email error break the caller
        logger.error("failed to send email to %s: %s", to, exc)
        return False


def _p(text: str) -> str:
    return f"<p align='right'>{text}</p>"


def _zero_offset(offset: int) -> str:
    # Legacy: "" when the offset renders as 2 digits, else "0" (so 0->"00", 5->"05", 15->"15").
    return "" if len(str(offset)) == 2 else "0"


def _booking_body(order, paid_by: str) -> str:
    """Shared booking-confirmation HTML (PelecardGoodController / PaymentController)."""
    user = order.user
    slot = order.slot
    tmpl = slot.rental_template
    club = tmpl.club
    offset = tmpl.minutes_offset or 0
    z = _zero_offset(offset)
    addr = club.address
    street = addr.street if addr else ""
    city = addr.city if addr else ""

    html = (
        f"<p align='right'>{user.first_name} {user.last_name}  שלום </p><br>"
        + _p(".תודה על פעולה שביצעת")
        + _p("סוג פעולה: שכירת מגרש טניס")
        + _p(f"מועדון: {club.club_name}")
        + _p(f"לתאריך: {slot.curdate}")
        + _p(f"מספר מגרש: {tmpl.court_number}")
        + _p(f"משעה: {slot.hour}:{z}{offset}")
        + _p(f"עד שעה: {slot.hour + 1}:{z}{offset}")
        + _p(f"מספר אישור: {order.order_id}")
        + _p(paid_by) + "<br>"
    )
    if club.sms_to_gate and club.sms_to_gate.strip() == "Y":
        html += (
            f"<p align='right'> בזמן ההגעה למגרש, הכניסה והיציאה דרך השער תתאפשר ע''י חיוג מהטלפון שלך שמספרו "
            f"{user.phone_number} למספר {club.gate_phone}</p><br>"
        )
    html += CONTACT_LINK
    html += _p(".לעזרה או שאלות בנוגע לרכישה, ניתן לפנות לעמוד שאלות נפוצות באתר") + "<br>"
    html += _p(f"בכל בעיה ניתן לפנות למנהל המועדון {club.contact_name} בטלפון {club.contact_phone} או במייל {club.email}") + "<br>"
    html += _p(f"כתובת המועדון {street} {city} ") + "<br>"
    html += _p(".נא הדפס והבא הודעה זו") + "<br>"
    html += _p(",תודה")
    html += _p("צוות באקו")
    return html


def send_booking_confirmation_cc(order) -> bool:
    """Booking paid by credit card — PelecardGoodController.sendEmail."""
    try:
        body = _booking_body(order, "ההזמנה שולמה על ידי כרטיס אשראי")
        subject = "הזמנה  , אישור הזמנה מאתר באקו  " + str(order.id)
        return send_email(order.user.username, subject, body)
    except Exception as exc:
        logger.error("booking-cc email build failed for order %s: %s", getattr(order, "id", "?"), exc)
        return False


def send_booking_confirmation_ticket(order) -> bool:
    """Booking paid by ticket (כרטיסייה) — PaymentController.sendEmail."""
    try:
        body = _booking_body(order, "ההזמנה שולמה על ידי כרטיסיה")
        subject = " שלום " + order.user.first_name + " " + order.user.last_name
        return send_email(order.user.username, subject, body)
    except Exception as exc:
        logger.error("booking-ticket email build failed for order %s: %s", getattr(order, "id", "?"), exc)
        return False


def send_ticket_purchase_confirmation(customer_ticket) -> bool:
    """Ticket purchase — PelecardTicketGoodController.sendEmail."""
    try:
        user = customer_ticket.user
        club_ticket = customer_ticket.club_ticket
        club = club_ticket.club
        html = (
            f"<p align='right'>{user.first_name} {user.last_name}  שלום </p><br>"
            + _p(".תודה על פעולה שביצעת")
            + _p("סוג פעולה: רכישת כרטיסיה")
            + _p(f"מועדון: {club.club_name}")
            + _p("ההזמנה שולמה על ידי כרטיס אשראי") + "<br>"
            + CONTACT_LINK
            + _p(".לעזרה או שאלות בנוגע לרכישה, ניתן לפנות לעמוד שאלות נפוצות באתר") + "<br>"
            + _p(f"בכל בעיה ניתן לפנות למנהל המועדון {club.club_name.strip()} בטלפון {club.contact_phone} או במייל {club.email}") + "<br>"
            + _p(",תודה")
            + _p("צוות באקו")
        )
        subject = "הזמנה  , אישור הזמנה מאתר באקו  " + str(customer_ticket.id)
        return send_email(user.username, subject, html)
    except Exception as exc:
        logger.error("ticket-purchase email build failed for ct %s: %s", getattr(customer_ticket, "id", "?"), exc)
        return False


def send_cancellation_email(order, is_user: bool) -> bool:
    """Cancellation (to user) / credit request (to club) — AvailableCourtsSearchController.sendCancelEmail."""
    try:
        user = order.user
        slot = order.slot
        tmpl = slot.rental_template
        club = tmpl.club
        offset = tmpl.minutes_offset or 0
        z = _zero_offset(offset)
        html = (
            "<p align='right'> </p><br>"
            + _p(f"מועדון: {club.club_name}")
            + _p(f"לתאריך: {slot.curdate}")
            + _p(f"מספר מגרש: {tmpl.court_number}")
            + _p(f"משעה: {slot.hour}:{z}{offset}")
            + _p(f"עד שעה: {slot.hour + 1}:{z}{offset}")
            + _p(f"מספר אישור: {order.order_id}")
            + _p(f"שם מזמין: {user.first_name} {user.last_name}")
            + _p("צוות באקו")
        )
        if is_user:
            to = user.username
            subject = "ביטול הזמנה   " + str(order.order_id)
        else:
            to = club.email
            subject = "בקשה לזיכוי   " + str(order.order_id)
        return send_email(to, subject, html)
    except Exception as exc:
        logger.error("cancellation email build failed for order %s: %s", getattr(order, "id", "?"), exc)
        return False


def send_add_to_group_email(user, club, end_date: date, ticket_type: str) -> bool:
    """User added to a club group — ClubCustomerPermittedTicketController.sendAddUserToGroupdEmail."""
    try:
        today = date.today()
        today_str = f"{today.day}-{today.month}-{today.year}"
        end_str = f"{end_date.day}-{end_date.month}-{end_date.year}"
        addr = club.address
        street = addr.street if addr else ""
        city = addr.city if addr else ""
        html = (
            f"<p align='right'>{user.first_name} {user.last_name}  שלום </p><br>"
            + f"<p align='right'> מנהל מועדון : {club.club_name} צירף אותך לקבוצה {ticket_type}</p><br>"
            + f"<p align='right'>  בתאריך {today_str} עד לתאריך {end_str}</p><br>"
            + "<p align='right'> " + CONTACT_LINK
            + _p(".לעזרה או שאלות , ניתן לפנות לעמוד שאלות נפוצות באתר") + "<br>"
            + _p(f"בכל בעיה ניתן לפנות למנהל המועדון {club.contact_name} בטלפון {club.contact_phone} או במייל {club.email}") + "<br>"
            + _p(f"כתובת המועדון {street} {city} ") + "<br>"
            + _p(",תודה")
            + _p("צוות באקו")
        )
        subject = " שלום " + user.first_name + " " + user.last_name
        return send_email(user.username, subject, html)
    except Exception as exc:
        logger.error("add-to-group email build failed: %s", exc)
        return False


def send_reset_password_email(user, url: str) -> bool:
    """Password reset link — ResetPasswordController.sendEmail."""
    try:
        html = (
            f"<p align='right'>{user.first_name} {user.last_name}  שלום </p><br>"
            + _p("מצורף לינק לאיפוס סיסמא")
            + f"<a href='{url}'>אפס סיסמא</a></p><br>"
            + _p("צוות באקו")
        )
        subject = "איפוס סיסמא באתר באקו"
        return send_email(user.username, subject, html)
    except Exception as exc:
        logger.error("reset-password email build failed: %s", exc)
        return False


def send_contact_email(contact, club_email: str) -> bool:
    """Contact-us form -> club email — ContactController.save."""
    try:
        html = (
            f" שם פרטי = {contact.first_name}<br/>"
            f" שם משפחה = {contact.last_name}<br/>"
            f" טלפון = {contact.phone_number}<br/>"
            f" מייל = {contact.email}<br/>"
            f" סוג פניה = {contact.type_of}<br/>"
            f" תוכן פניה = {contact.content}<br/>"
        )
        subject = "conact us " + str(contact.id)
        return send_email(club_email, subject, html)
    except Exception as exc:
        logger.error("contact email build failed: %s", exc)
        return False
