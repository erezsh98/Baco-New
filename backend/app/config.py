from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    pelecard_gateway_url: str = "https://gateway.pelecard.biz/Iframe"
    pelecard_matnasim_term: str = ""
    pelecard_matnasim_password: str = ""
    pelecard_evenyhuda_term: str = ""
    pelecard_evenyhuda_password: str = ""
    pelecard_kadimatennis_term: str = ""
    pelecard_kadimatennis_password: str = ""
    pelecard_shasho_term: str = ""
    pelecard_shasho_password: str = ""

    sms_username: str = ""
    sms_password: str = ""
    sms_gateway_url: str = "https://www.019sms.co.il:8090/api"

    smtp_host: str = "localhost"
    smtp_port: int = 25
    smtp_user: str = ""
    smtp_password: str = ""
    email_from: str = "noreply@tennisline.co.il"

    app_base_url: str = "http://localhost"
    frontend_base_url: str = "http://localhost:3000"   # used to build user-facing links (e.g. password reset)
    anthropic_api_key: str = ""

    # When true, payment gateway (Pelecard) is bypassed and purchases/bookings
    # are confirmed immediately. For local development without live credentials.
    dev_mode: bool = False

    class Config:
        env_file = ".env"


settings = Settings()
