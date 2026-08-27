"""Custom SQLAlchemy column types shared by the models."""
from datetime import datetime

from sqlalchemy.types import Date as _Date
from sqlalchemy.types import TypeDecorator


class Date(TypeDecorator):
    """A DATE column that tolerates a DATETIME value in the database.

    The legacy/production schema stores these fields as DATETIME (Grails/GORM
    mapped java.util.Date -> DATETIME), and on MySQL SQLAlchemy's native Date
    passes the DBAPI value through unchanged — so a DATETIME column comes back
    as a `datetime`, not a `date`. Comparing a datetime with a plain date (e.g.
    `end_date >= date.today()` in Python) raises TypeError. Truncating to a
    plain date on read makes reads consistent whether the underlying column is
    DATE (dev) or DATETIME (production).

    Bind (write) side is unchanged: a date/datetime parameter binds normally,
    so SQL-side filters (`Column >= today`) keep working.
    """

    impl = _Date
    cache_ok = True

    def process_result_value(self, value, dialect):
        if isinstance(value, datetime):
            return value.date()
        return value
