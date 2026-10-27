from fastapi import APIRouter

router = APIRouter()

@router.get("/prueba")
def prueba():
    return {"status": "ok", "service": "sportsService"}