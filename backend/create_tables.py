from app.database import Base, engine
from app.models import *
from sqlalchemy import inspect

print("Creating all tables...")
Base.metadata.create_all(bind=engine)
print("Done!\n")

inspector = inspect(engine)
tables = inspector.get_table_names()
print(f"Tables created ({len(tables)}):")
for t in sorted(tables):
    print(f"  - {t}")
