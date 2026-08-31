"""
Pelecard iframe integration — ported to match the legacy CreditCardService.

The gateway's Iframe endpoint (pageName=ajaxPage) is POSTed a form with the
terminal credentials and returns the payment-form **HTML** to embed (not a URL).
On completion Pelecard redirects the form to goodUrl/errorUrl with a fixed-width
`result` string that encodes status/amount/approval (see routers/payment.py).
"""
import httpx

from app.config import settings

# club u_name -> Pelecard terminal credentials (from .env)
CLUB_CREDENTIALS = {
    "matnasim":     {"term": settings.pelecard_matnasim_term,     "password": settings.pelecard_matnasim_password},
    "evenyhuda":    {"term": settings.pelecard_evenyhuda_term,    "password": settings.pelecard_evenyhuda_password},
    "kadimatennis": {"term": settings.pelecard_kadimatennis_term, "password": settings.pelecard_kadimatennis_password},
    "shasho":       {"term": settings.pelecard_shasho_term,       "password": settings.pelecard_shasho_password},
}

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
