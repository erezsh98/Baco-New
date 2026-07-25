import httpx

from app.config import settings

CLUB_CREDENTIALS = {
    "matnasim":     {"term": settings.pelecard_matnasim_term,     "password": settings.pelecard_matnasim_password},
    "evenyhuda":    {"term": settings.pelecard_evenyhuda_term,     "password": settings.pelecard_evenyhuda_password},
    "kadimatennis": {"term": settings.pelecard_kadimatennis_term,  "password": settings.pelecard_kadimatennis_password},
    "shasho":       {"term": settings.pelecard_shasho_term,        "password": settings.pelecard_shasho_password},
}


def build_pelecard_iframe(order_id: int, amount_nis: float, club_uname: str, purchase_type: int) -> str:
    """
    Returns an XML string from Pelecard containing the iframe embed URL.
    purchase_type: 1=ticket, 2=court rental
    amount_nis: amount in NIS (will be converted to agorot = *100)
    """
    creds = CLUB_CREDENTIALS.get(club_uname)
    if not creds:
        raise ValueError(f"No Pelecard credentials for club: {club_uname}")

    amount_agorot = int(amount_nis * 100)
    success_url = f"{settings.app_base_url}/api/payment/pelecard-good"
    error_url = f"{settings.app_base_url}/api/payment/pelecard-bad"
    if purchase_type == 1:
        success_url = f"{settings.app_base_url}/api/payment/pelecard-ticket-good"
        error_url = f"{settings.app_base_url}/api/payment/pelecard-ticket-bad"

    params = {
        "user": creds["term"],
        "password": creds["password"],
        "termNo": creds["term"],
        "parmX": f"baco-{order_id}",
        "total": str(amount_agorot),
        "currency": "1",          # 1 = ILS
        "maxPayments": "1",
        "goodURL": success_url,
        "errorURL": error_url,
        "cancelURL": error_url,
        "cvv2Field": "1",
        "IdField": "1",
        "lang": "HE",
    }

    response = httpx.post(settings.pelecard_gateway_url, data=params, timeout=30)
    response.raise_for_status()
    return response.text
