from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import auth, bookings, clubs, contact, courts, payment, tickets, users, admin, schedule, holidays, audit, super_admin
from app.services.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="TennisLine API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(courts.router)
app.include_router(bookings.router)
app.include_router(payment.router)
app.include_router(tickets.router)
app.include_router(clubs.router)
app.include_router(users.router)
app.include_router(admin.router)
app.include_router(schedule.router)
app.include_router(holidays.router)
app.include_router(audit.router)
app.include_router(super_admin.router)
app.include_router(contact.router)


@app.get("/health")
def health():
    return {"status": "ok"}
