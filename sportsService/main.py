from fastapi import FastAPI
from routers.pruebas import router as pruebas_router
from routers.users import router as users_router
from routers.players import router as players_router
from routers.teams import router as teams_router
from routers.exercises import router as exercises_router
from routers.trainings import router as trainings_router
from routers.ai import router as ai_router

app = FastAPI(
    title="BasketCoach - Sports Service",
    swagger_ui_parameters={"persistAuthorization": True},
)

app.include_router(pruebas_router)
app.include_router(users_router)
app.include_router(players_router)
app.include_router(teams_router)
app.include_router(exercises_router)
app.include_router(trainings_router)
app.include_router(ai_router)
