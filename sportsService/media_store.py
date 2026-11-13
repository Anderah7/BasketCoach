"""Validated local storage for uploaded photos and videos."""

import os
import re
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile


IMAGE_LIMIT = 8 * 1024 * 1024
AVATAR_LIMIT = 5 * 1024 * 1024
VIDEO_LIMIT = 80 * 1024 * 1024
MAX_FILES_PER_UPLOAD = 5
MAX_MEDIA_PER_ENTITY = 12
_KEY_PATTERN = re.compile(r"^[0-9a-f]{32}\.(png|jpg|webp|gif|mp4|webm)$")


@dataclass(frozen=True)
class StoredFile:
    storage_key: str
    content_type: str
    media_type: str
    size_bytes: int


def media_root() -> Path:
    configured = os.getenv("MEDIA_ROOT", "./uploads")
    root = Path(configured)
    if not root.is_absolute():
        root = Path(__file__).resolve().parent / root
    return root.resolve()


def media_path(storage_key: str) -> Path:
    if not _KEY_PATTERN.fullmatch(storage_key):
        raise ValueError("Invalid media storage key")
    return media_root() / storage_key


def remove_file(storage_key: str) -> None:
    media_path(storage_key).unlink(missing_ok=True)


def _detect_type(header: bytes) -> tuple[str, str, str] | None:
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "image", ".png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "image", ".jpg"
    if header.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif", "image", ".gif"
    if header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp", "image", ".webp"
    if header[4:8] == b"ftyp":
        return "video/mp4", "video", ".mp4"
    if header.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in header.lower():
        return "video/webm", "video", ".webm"
    return None


def store_upload(upload: UploadFile, *, avatar: bool = False) -> StoredFile:
    upload.file.seek(0)
    detected = _detect_type(upload.file.read(4096))
    upload.file.seek(0)
    if detected is None or (avatar and detected[1] != "image"):
        raise HTTPException(status_code=422, detail="Use a PNG, JPEG, WebP or GIF image, or an MP4 or WebM video")

    content_type, media_type, extension = detected
    limit = AVATAR_LIMIT if avatar else (VIDEO_LIMIT if media_type == "video" else IMAGE_LIMIT)
    key = f"{uuid4().hex}{extension}"
    root = media_root()
    root.mkdir(parents=True, exist_ok=True)
    temporary_path = root / f"{key}.part"
    final_path = root / key
    total = 0
    try:
        with temporary_path.open("wb") as target:
            while chunk := upload.file.read(1024 * 1024):
                total += len(chunk)
                if total > limit:
                    raise HTTPException(status_code=413, detail=f"File exceeds the {limit // (1024 * 1024)} MB limit")
                target.write(chunk)
        if total == 0:
            raise HTTPException(status_code=422, detail="Empty files are not allowed")
        os.replace(temporary_path, final_path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        final_path.unlink(missing_ok=True)
        raise
    finally:
        upload.file.close()

    return StoredFile(key, content_type, media_type, total)
