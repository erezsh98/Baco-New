import httpx

from app.config import settings


def _open_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<bulk><user>"
        f"<username>{settings.sms_username}</username>"
        f"<password>{settings.sms_password}</password>"
        "</user><messages>"
    )


def _close_xml(body: str) -> str:
    return body + "</messages><response>0</response></bulk>"


def _add_sms(body: str, message: str, mobile: str, sms_id: int) -> str:
    return (
        body
        + "<sms>"
        + "<source>Baco</source>"
        + "<destinations>"
        + f'<phone id="{sms_id}">+972{mobile.lstrip("0")}</phone>'
        + "</destinations>"
        + f"<message>{message}</message>"
        + "</sms>"
    )


def _post(xml: str) -> None:
    httpx.post(settings.sms_gateway_url, content=xml.encode("utf-8"), timeout=15)


def send_booking_sms(manager_phone: str, message: str) -> None:
    xml = _open_xml()
    xml = _add_sms(xml, message, manager_phone, 1)
    xml = _close_xml(xml)
    _post(xml)


def open_gate_for_user(gate_phone: str, gate_pass: str, customer_phone: str, start_hour: int, start_minute: int, end_hour: int) -> None:
    message = f"{gate_pass} A {customer_phone} T{start_hour:02d}:{start_minute:02d}-{end_hour:02d}:00"
    xml = _open_xml()
    xml = _add_sms(xml, message, gate_phone, 1)
    xml = _close_xml(xml)
    _post(xml)


def clear_customer_from_gate(gate_phone: str, gate_pass: str, customer_phone: str) -> None:
    message = f"{gate_pass} D {customer_phone}"
    xml = _open_xml()
    xml = _add_sms(xml, message, gate_phone, 1)
    xml = _close_xml(xml)
    _post(xml)


def clear_gates_lock(gate_phone: str, gate_pass: str) -> None:
    message = f"{gate_pass} EV CLEAR"
    xml = _open_xml()
    xml = _add_sms(xml, message, gate_phone, 1)
    xml = _close_xml(xml)
    _post(xml)
