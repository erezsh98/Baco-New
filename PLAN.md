# TennisLine Rewrite Plan — FastAPI + Next.js

## Context
Full rewrite of a Grails 2.4 tennis court booking system. The existing app handles court search, booking, Pelecard credit card payments, 019 SMS gate access, and a ticket/subscription system for Israeli tennis clubs. The rewrite uses FastAPI (Python) + Next.js 15 (React/Tailwind/shadcn) + MySQL (existing DB), deployed locally via Docker Compose, then GCP later.

---

## Monorepo Structure

```
tennisline-new/
├── backend/            # FastAPI (Python 3.12)
├── frontend/           # Next.js 15
├── docker-compose.yml
└── nginx/              # Reverse proxy config
```

---

## Phase 1 — Backend (FastAPI)

### 1.1 Project Scaffold
- Key packages: fastapi, uvicorn, sqlalchemy, alembic, python-jose[cryptography], passlib[bcrypt], apscheduler, httpx, python-multipart, mysqlclient
- Folder structure:
  ```
  backend/
  ├── app/
  │   ├── main.py
  │   ├── database.py        # SQLAlchemy engine + session
  │   ├── models/            # ORM models (one file per domain)
  │   ├── schemas/           # Pydantic request/response schemas
  │   ├── routers/           # FastAPI routers (one per domain)
  │   ├── services/          # Business logic (payment, sms, scheduler)
  │   ├── auth/              # JWT auth, password hashing
  │   └── config.py          # Settings from .env
  ├── alembic/               # DB migrations
  └── Dockerfile
  ```

### 1.2 Database Models (SQLAlchemy)
Port all 32 domain classes. Priority order:
1. users, roles, user_roles
2. areas, addresses, clubs, club_managers
3. rental_template, available_courts_search, court_lock_dates
4. court_order, users_cart, rental_log
5. club_ticket, customer_ticket, ticket_active_time, club_customer_permitted_ticket
6. holiday_dates, holiday_overwrite
7. reset_password, contact, pelecard_error_list

### 1.3 Auth (JWT)
- POST /auth/login
- POST /auth/register
- POST /auth/reset-password
- GET  /auth/reset-password/{token}

### 1.4 REST Endpoints (~65 total)

| Router       | Key Endpoints                                      |
|--------------|----------------------------------------------------|
| /courts      | Search available courts, get slot detail           |
| /bookings    | Create booking, list past/future, cancel           |
| /payment     | Payment options, process order, Pelecard callbacks |
| /tickets     | List club tickets, purchase, list user tickets     |
| /clubs       | CRUD clubs (admin), list for search                |
| /templates   | CRUD rental templates (admin), rebuild availability|
| /admin       | Club managers, user permissions, holiday dates     |
| /users       | CRUD users, profile update                         |
| /contact     | Submit contact form, FAQ                           |
| /scheduler   | Admin-triggered: rebuild, SMS commands             |

### 1.5 Services
- services/payment.py  — Pelecard iframe builder
- services/sms.py      — 019 SMS gate + manager notifications
- services/scheduler.py — APScheduler jobs (rebuild, release carts, SMS)
- services/email.py    — confirmation + cancellation emails

### 1.6 Configuration
- All secrets in .env (DB URL, JWT secret, Pelecard creds, SMS creds, SMTP)
- config.py reads via pydantic-settings

---

## Phase 2 — Frontend (Next.js 15)

### Screens
1. Home / Search — area, date/time picker
2. Search Results — available slots table
3. Payment — ticket vs credit card, Pelecard iframe
4. Thank You — booking confirmation
5. My Bookings — future / past tabs, cancel
6. My Tickets — punch balance
7. Buy Ticket — club selector, package list
8. Login / Register / Reset Password
9. Admin: Club Orders — date range, cancel order
10. Admin: Club Permissions — add/remove users

### AI Agent Widget
- Floating chat on all pages
- Claude API (claude-sonnet-4-6) via Next.js API route
- Tools: search_courts, get_my_bookings, cancel_booking

---

## Phase 3 — Docker Compose

```yaml
services:
  backend:  FastAPI on :8000
  frontend: Next.js on :3000
  nginx:    reverse proxy on :80
  mysql:    MySQL 8 with persistent volume
```

---

## Build Order

1. Backend scaffold + DB models + auth → test with Swagger UI (/docs)
2. Courts search + booking endpoints
3. Pelecard + SMS services
4. Scheduler (APScheduler)
5. Frontend scaffold + auth screens
6. Search + booking flow UI
7. My bookings + tickets UI
8. Admin panel UI
9. AI agent widget
10. Docker Compose wiring
11. Data migration from existing MySQL play_tennis DB

---

## Key Decisions
- Keep Pelecard (Israeli payment gateway)
- Keep 019 SMS (gate integration)
- Keep MySQL, migrate schema with Alembic
- No microservices — one FastAPI app + one Next.js app
- All credentials in .env, never in source code
