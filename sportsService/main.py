from fastapi import FastAPI
from routers.pruebas import router as pruebas_router
from routers.users import router as users_router

app = FastAPI(title="BasketCoach - Sports Service")

app.include_router(pruebas_router)
app.include_router(users_router)