"""
Diagnose / verify the SMTP e-mail setup.

    python test_email.py [recipient@example.com]

Prints the SMTP config, runs each step (connect -> TLS -> login -> send) with
clear success/failure, and sends a real test message (default: to smtp_user).
Use it on the target environment to confirm e-mail actually goes out.
"""
import sys
import smtplib
from email.mime.text import MIMEText

from app.config import settings


def main(recipient: str) -> int:
    host = settings.smtp_host
    port = settings.smtp_port
    user = settings.smtp_user
    pw = settings.smtp_password or ""
    sender = settings.email_from or user

    print("=== SMTP configuration ===")
    print(f"  host        : {host}")
    print(f"  port        : {port}  ({'SSL' if port == 465 else 'STARTTLS' if port in (587, 25) else '?'})")
    print(f"  user        : {user}")
    print(f"  from        : {sender}")
    print(f"  password len: {len(pw)}")
    print(f"  recipient   : {recipient}")
    print()

    # config sanity checks (provider-aware)
    problems = []
    if not host:
        problems.append("SMTP_HOST is empty.")
    if "mailgun.org" in host:
        if not user or not user.startswith("postmaster@"):
            problems.append("Mailgun SMTP_USER should be postmaster@<your-domain> "
                            "(Mailgun > Sending > Domains > <domain> > SMTP credentials).")
        if not pw:
            problems.append("Mailgun SMTP_PASSWORD is empty; copy it from the Mailgun domain's SMTP credentials.")
    elif host == "smtp.gmail.com":
        if len(pw) != 16:
            problems.append(f"Gmail needs a 16-char App Password; current length is {len(pw)}. "
                            "Enable 2-Step Verification and create one at myaccount.google.com/apppasswords.")
        if not user:
            problems.append("SMTP_USER is empty (Gmail requires authentication).")
    elif host == "localhost":
        # production-style local relay (Postfix -> Mailgun): no auth expected.
        pass
    if problems:
        print("!! Configuration warnings:")
        for p in problems:
            print("   -", p)
        print()

    msg = MIMEText("<p dir='rtl'>בדיקת שליחת דוא\"ל מאתר באקו. אם הגיע - הדוא\"ל תקין.</p>", "html", "utf-8")
    msg["Subject"] = "BACO - email test"
    msg["From"] = sender
    msg["To"] = recipient

    try:
        print(f"[1/4] connecting to {host}:{port} ...")
        if port == 465:
            smtp = smtplib.SMTP_SSL(host, port, timeout=20)
        else:
            smtp = smtplib.SMTP(host, port, timeout=20)
        with smtp:
            print("      connected.")
            if port != 465:
                print("[2/4] STARTTLS ...")
                smtp.ehlo(); smtp.starttls(); smtp.ehlo()
                print("      TLS established.")
            else:
                print("[2/4] SSL socket (no STARTTLS needed).")
            if user:
                print("[3/4] logging in ...")
                smtp.login(user, pw)
                print("      login OK.")
            else:
                print("[3/4] no user set - skipping login.")
            print("[4/4] sending message ...")
            smtp.send_message(msg)
            print("      SENT.")
        print("\nSUCCESS: test e-mail sent to", recipient)
        return 0
    except smtplib.SMTPAuthenticationError as e:
        print("\nFAILED at login (authentication):", e)
        print("  -> Credentials rejected. Mailgun: use postmaster@<domain> + the domain's SMTP password. "
              "Gmail: use a 16-char App Password (2-Step Verification required).")
        return 1
    except (smtplib.SMTPConnectError, OSError, TimeoutError) as e:
        print("\nFAILED to connect:", e)
        print("  -> The network is likely blocking outbound SMTP (port", str(port) + ").",
              "Corporate networks often block it; a home network usually does not.")
        return 1
    except Exception as e:
        print("\nFAILED:", type(e).__name__, e)
        return 1


if __name__ == "__main__":
    to = sys.argv[1] if len(sys.argv) > 1 else (settings.smtp_user or "")
    if not to:
        print("usage: python test_email.py <recipient@example.com>")
        sys.exit(2)
    sys.exit(main(to))
