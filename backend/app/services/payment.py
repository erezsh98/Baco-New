"""
Pelecard iframe integration — ported to match the legacy CreditCardService.

The gateway's Iframe endpoint (pageName=ajaxPage) is POSTed a form with the
terminal credentials and returns the payment-form **HTML** to embed (not a URL).
On completion Pelecard redirects the form to goodUrl/errorUrl with a fixed-width
`result` string that encodes status/amount/approval (see routers/payment.py).
"""
import os
from pathlib import Path

import httpx

from app.config import settings


def _env_file_values() -> dict[str, str]:
    """Parse KEY=VALUE lines from the backend .env (the same file pydantic loads),
    so club credentials work whether they live in .env (dev) or in real environment
    variables (production / systemd). Best-effort — a missing file is fine."""
    values: dict[str, str] = {}
    try:
        for line in Path(".env").read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return values


def club_credentials(club_uname: str) -> dict[str, str] | None:
    """Pelecard terminal credentials for a club, by its u_name.

    Read dynamically from env vars named PELECARD_<UNAME>_TERM /
    PELECARD_<UNAME>_PASSWORD (u_name upper-cased), so a new club is added by an
    env change only — no code edit. Real environment variables win over .env.
    Returns None when no terminal is configured for the club.
    """
    key = (club_uname or "").strip().upper()
    if not key:
        return None
    file_vals = _env_file_values()
    term = os.environ.get(f"PELECARD_{key}_TERM") or file_vals.get(f"PELECARD_{key}_TERM")
    if not term:
        return None
    password = (os.environ.get(f"PELECARD_{key}_PASSWORD")
                or file_vals.get(f"PELECARD_{key}_PASSWORD") or "")
    return {"term": term, "password": password}

def _looks_like_payment_form(html: str) -> bool:
    """A successful ajaxPage response is the payment-form HTML (contains the
    credit-card fields / main container). An error is a short message without it."""
    h = (html or "").lower()
    return "creditcard" in h or "maindiv" in h or "cardholder" in h or "<form" in h


def build_pelecard_iframe(order_id: int, amount_nis: float, club_uname: str, purchase_type: int) -> str:
    """
    Initialize a Pelecard payment and return the payment-form **HTML** to embed
    (the caller renders it inside an <iframe srcdoc>).
    purchase_type: 1 = ticket, 2 = court rental. amount_nis is in NIS (→ agorot).
    Mirrors the legacy CreditCardService.buidPelecardIframe parameter set, except
    it drops frmAction=CreateToken so charges are regular one-time sales rather
    than tokenized "הוראת קבע" transactions (the token was never reused).
    """
    creds = club_credentials(club_uname)
    if not creds or not creds.get("term"):
        raise ValueError(f"No Pelecard credentials for club: {club_uname}")

    amount_agorot = int(round(amount_nis * 100))
    base = settings.app_base_url.rstrip("/")
    if purchase_type == 1:
        good = f"{base}/payment/pelecard-ticket-good"
        bad = f"{base}/payment/pelecard-ticket-bad"
    else:
        good = f"{base}/payment/pelecard-good"
        bad = f"{base}/payment/pelecard-bad"

    params = {
        "userName": club_uname,
        "password": creds["password"],
        "termNo": creds["term"],
        "pageName": "ajaxPage",
        "goodUrl": good,
        "errorUrl": bad,
        "ValidateLink": good,
        "ErrorLink": bad,
        "total": str(amount_agorot),      # agorot
        "currency": "1",                  # 1 = ILS
        "maxPayments": "1",
        "minPaymentsNo": "1",
        "hidePelecardLogo": "True",
        "background": "transparent",
        "supportedCardTypes": "True,True,True,False,True",
        "Parmx": f"baco-{order_id}",
        "hideParmx": "True",
        "SupportPhone": "1700700700",
        "id": "Must",                     # customer must enter ID number
        "cvv2": "Must",                   # customer must enter CVV
        "shopNo": "001",
        # No frmAction=CreateToken: that tokenizes the card ("saved card"), which
        # makes Pelecard record the charge as "הוראת קבע". Omitting it charges a
        # regular one-time sale (עסקה רגילה). The token was stored on order.token
        # but never used for a follow-up charge/refund, so nothing depends on it.
        "J5": "false",
        "keepSSL": "false",
        "DesignInput": "false",
        "CCDash": "True",
    }

    response = httpx.post(settings.pelecard_gateway_url, data=params, timeout=30)
    response.raise_for_status()
    html = response.text or ""
    # ajaxPage returns the payment-form HTML; a failure returns a short error
    # message with no form — surface that as an error instead of showing raw text.
    if not _looks_like_payment_form(html):
        raise ValueError(f"Pelecard init failed: {html.strip()[:300]}")
    return html
