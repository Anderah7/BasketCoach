from fastapi import FastAPI
from routers.pruebas import router as pruebas_router
from routers.users import router as users_router
from routers.players import router as players_router
from routers.teams import router as teams_router
from routers.exercises import router as exercises_router
from routers.trainings import router as trainings_router
from routers.ai import router as ai_router
from routers.media import router as media_router
from routers.friends import router as friends_router
from routers.matches import router as matches_router
from notification_outbox import notification_lifespan

app = FastAPI(
    lifespan=notification_lifespan,
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
app.include_router(media_router)
app.include_router(friends_router)
app.include_router(matches_router)
