# Photos and videos

`sportsService` stores file metadata in PostgreSQL and the files under `MEDIA_ROOT` (`./uploads` inside the service by default). Run `python -m alembic upgrade head` from `sportsService` before starting the updated server. The upload directory is ignored by Git and should be backed up together with the database.

- `PUT /users/me/avatar` accepts one image in multipart field `file`; `DELETE /users/me/avatar` removes it.
- `POST /exercises/{exercise_id}/media` and `POST /trainings/{training_id}/media` accept up to five multipart fields named `files` per request.
- `DELETE /media/{asset_id}` removes an owned file. `GET /media/{asset_id}` requires JWT and checks access to the linked exercise or session.
- The frontend uses `/api/sports` through the Gateway for uploads and protected downloads.

Supported formats: PNG, JPEG, WebP, GIF, MP4 and WebM. Each avatar is limited to 5 MB, each exercise or session image to 8 MB, and each video to 80 MB. An exercise or session can have up to 12 files.
