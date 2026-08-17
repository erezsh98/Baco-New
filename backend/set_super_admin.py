"""
Assign the single system super-user (ROLE_SUPER_ADMIN).

    python set_super_admin.py <email>

Creates the role if missing, REVOKES it from anyone who currently holds it
(guaranteeing exactly one super-user), then grants it to the given user.
Re-run with a different email to change the super-user in production — no code
change, no redeploy. The target user must already have an account.
"""
import sys

from app.database import SessionLocal
from app.models.user import Role, User, UserRole

SUPER = "ROLE_SUPER_ADMIN"


def main(email: str) -> int:
    db = SessionLocal()
    try:
        role = db.query(Role).filter(Role.authority == SUPER).first()
        if not role:
            role = Role(authority=SUPER)
            db.add(role)
            db.flush()
            print(f"created role {SUPER} (id={role.id})")

        user = db.query(User).filter(User.username == email).first()
        if not user:
            print(f"ERROR: no user with email {email!r}. Create the account first.")
            return 1

        # exactly one: revoke from everyone else
        revoked = (
            db.query(UserRole)
            .filter(UserRole.role_id == role.id, UserRole.user_id != user.id)
            .delete(synchronize_session=False)
        )
        if revoked:
            print(f"revoked {SUPER} from {revoked} other user(s)")

        already = (
            db.query(UserRole)
            .filter(UserRole.user_id == user.id, UserRole.role_id == role.id)
            .first()
        )
        if not already:
            db.add(UserRole(user_id=user.id, role_id=role.id))
        db.commit()
        print(f"OK: {email} (user id={user.id}) is now the super-user (role_id={role.id}).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python set_super_admin.py <email>")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
