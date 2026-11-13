from fastapi import FastAPI
from routers.generate import router as generate_router
from routers.pruebas import router as pruebas_router

app = FastAPI(title="BasketCoach - AI Training Service")

app.include_router(pruebas_router)
app.include_router(generate_router)
