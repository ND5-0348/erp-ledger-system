# ERP Ledger System

React + Vite frontend with a FastAPI + MySQL backend for the 2026 supply-chain ledger.

## Documentation

- [Local deployment guide](docs/LOCAL_DEPLOYMENT.md)

## Local Runtime

Prerequisites:

- Node.js
- Python 3.8.5 at `C:\Users\asus\AppData\Local\Programs\Python\Python38\python.exe`
- MySQL 5.7.21 on `127.0.0.1:3306`
- MySQL user with permission to create and use the local `erp_ledger` database

Install dependencies:

```powershell
npm install
C:\Users\asus\AppData\Local\Programs\Python\Python38\python.exe -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install "pip<25"
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
```

Copy `backend/.env.example` to `backend/.env` and set local credentials. Do not commit `backend/.env`.

Initialize database and import Excel:

```powershell
cd backend
@'
from app.db import initialize_schema, db
from app.importer import import_excel
initialize_schema()
with db() as conn:
    print(import_excel(conn, reset=True))
'@ | .\.venv\Scripts\python.exe -
cd ..
```

Run backend:

```powershell
npm run backend:dev
```

Run frontend:

```powershell
npm run dev
```

Open:

- Frontend: http://127.0.0.1:3000
- Backend health: http://127.0.0.1:8001/api/health

Default login:

- Username: `admin`
- Password: `admin123`

Configure a random `AUTH_SECRET` of at least 32 characters in `backend/.env`. `DEFAULT_ADMIN_PASSWORD` must contain at least 6 characters; the default value is `admin123`.

## Permissions

- `admin`: account management, system import, backup actions, order entry, purchase entry, and sales entry.
- `order_entry`: order detail entry and batch order import only.
- `purchase_entry`: purchase contract, invoice, and payment entry only.
- `sales_entry`: sales contract, invoice, and receipt entry only.
- `viewer`: read-only access.

## Data Rules

- `project.project_code` is unique.
- One project can have multiple `sales_order.order_no` records.
- Payment, receipt, invoice, and warehouse records support multiple phases through `phase_no`.
- Raw Excel rows are stored in `ledger_raw_row` for reconciliation.
