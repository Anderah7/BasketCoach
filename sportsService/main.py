from fastapi import FastAPI

app = FastAPI()

@app.get("/prueba")
def prueba():
    return {"status": "ok", "service": "sports-service"}