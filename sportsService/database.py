import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, URL

load_dotenv(Path(__file__).resolve().parent / ".env")

DATABASE_URL = URL.create(
    "postgresql+psycopg",
    username=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
    host=os.getenv("DB_HOST"),
    port=int(os.getenv("DB_PORT", "5432")),
    database=os.getenv("DB_NAME")
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)