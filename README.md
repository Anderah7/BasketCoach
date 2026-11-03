# BasketCoach

## Probar la autenticación en Swagger

Abre el Swagger del servicio deportivo en `http://localhost:8001/docs`.

1. Ejecuta `POST /users/login` con el correo y la contraseña. Copia el valor de `access_token` de la respuesta.
2. Pulsa **Authorize** y pega **solo el token**, sin el prefijo `Bearer`. Pulsa **Authorize** de nuevo y cierra el cuadro.
3. Ejecuta `GET /users/me`. Swagger enviará `Authorization: Bearer <token>` en esta y las siguientes peticiones protegidas. La autorización se conserva al recargar Swagger en el mismo navegador.

El token caduca a los 30 minutos. Si `/users/me` devuelve 401 después de ese tiempo, inicia sesión otra vez y actualiza el token en **Authorize**. El inicio de sesión devuelve el token, pero Swagger no lo añade automáticamente a **Authorize**.
