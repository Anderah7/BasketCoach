from fastapi import APIRouter

router = APIRouter()

@router.get("/pruebas")
def prueba():
    return {"status": "ok", "service": "aiTrainingService"}