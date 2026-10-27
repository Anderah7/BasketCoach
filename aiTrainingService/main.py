from fastapi import FastAPI
from routers.pruebas import router as pruebas_router

app = FastAPI(title="BasketCoach - AI Training Service")

app.include_router(pruebas_router)