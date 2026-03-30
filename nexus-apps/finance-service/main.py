from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import transactions, revenue, receivables
from database import init_db

app = FastAPI(
    title="MAIC Finance Service",
    description="Expense ledger, revenue tracking, and accounts receivable for MAIC.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(transactions.router, prefix="/finance/transactions", tags=["transactions"])
app.include_router(revenue.router,      prefix="/finance/revenue",      tags=["revenue"])
app.include_router(receivables.router,  prefix="/finance/receivables",  tags=["receivables"])


@app.on_event("startup")
async def startup():
    await init_db()


@app.get("/health")
async def health():
    return {"status": "ok", "service": "finance-service"}
