"""
Pelecard iframe integration — ported to match the legacy CreditCardService.

The gateway's Iframe endpoint (pageName=ajaxPage) is POSTed a form with the
terminal credentials and returns the iframe URL to embed. On completion Pelecard
redirects the iframe to goodUrl/errorUrl with a fixed-width `result` string that
encodes status/amount/approval (see routers/payment.py).
"""
import re

import httpx

from app.config import settings

# club u_name -> Pelecard terminal credentials (from .env)
CLUB_CREDENTIALS = {
    "matnasim":     {"term": settings.pelecard_matnasim_term,     "password": settings.pelecard_matnasim_password},
    "evenyhuda":    {"term": settings.pelecard_evenyhuda_term,    "password": settings.pelecard_evenyhuda_password},
    "kadimatennis": {"term": settings.pelecard_kadimatennis_term, "password": settings.pelecard_kadimatennis_password},
    "shasho":       {"term": settings.pelecard_shasho_term,       "password": settings.pelecard_shasho_password},
}

_URL_RE = re.compile(r'https?://[^\s<>"\']+')


def _extract_iframe_url(resp_text: str) -> str:
    """The Iframe endpoint returns the iframe URL (its old code names the response
    'xml'); on failure it returns an error string with no URL."""
    m = _URL_RE.search(resp_text or "")
    if not m:
        raise ValueError(f"Pelecard init failed: {(resp_text or '').strip()[:300]}")
    return m.group(0)


def build_pelecard_iframe(order_id: int, amount_nis: float, club_uname: str, purchase_type: int) -> str:
    """
    Initialize a Pelecard payment and return the iframe URL to embed.
    purchase_type: 1 = ticket, 2 = court rental. amount_nis is in NIS (→ agorot).
    Mirrors the legacy CreditCardService.buidPelecardIframe parameter set exactly.
    """
    creds = CLUB_CREDENTIALS.get(club_uname)
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
        "frmAction": "CreateToken",
        "J5": "false",
        "keepSSL": "false",
        "DesignInput": "false",
        "CCDash": "True",
    }

    response = httpx.post(settings.pelecard_gateway_url, data=params, timeout=30)
    response.raise_for_status()
    return _extract_iframe_url(response.text)
