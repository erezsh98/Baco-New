from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    pelecard_gateway_url: str = "https://gateway.pelecard.biz/Iframe"
    # Per-club Pelecard terminal credentials are NOT declared here. They are read
    # dynamically by club u_name from env vars named PELECARD_<UNAME>_TERM /
    # PELECARD_<UNAME>_PASSWORD — see app/services/payment.py:club_credentials().
    # Adding a club is therefore an env-only change (no code edit). The
    # `extra = "ignore"` in Config below lets those vars pass without a startup error.

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

    # When true, payment gateway (Pelecard) is bypassed and purchases/bookings
    # are confirmed immediately. For local development without live credentials.
    dev_mode: bool = False

    # Background jobs (rebuild, release_uncompleted_orders).
    # enable_scheduler: run them in-process via APScheduler. Keep True for
    #   dev/single-server. Set False in GCP when driving them with Cloud
    #   Scheduler instead, so they don't run twice.
    # scheduler_token: shared secret Cloud Scheduler must send in the
    #   X-Scheduler-Token header to call the /jobs endpoints. Empty = the
    #   /jobs endpoints are disabled (fail closed).
    enable_scheduler: bool = True
    scheduler_token: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"   # allow per-club PELECARD_<UNAME>_* vars (read dynamically)


settings = Settings()
