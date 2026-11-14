# Autenticación de la API

Los valores de los secretos viven solo en `.env` (local) y en las variables de entorno de Vercel. No se escriben nunca en el repositorio.

| Rutas | Mecanismo | Variable |
|---|---|---|
| Páginas del panel y `/api/admin/*` | Cookie `admin-session`: JWT HS256 de 2 h con `role: "admin"` | `JWT_SECRET`, `USER_NAME_ADMIN`, `USER_PASSWORD_ADMIN` |
| `/api/*` que consume la web pública | `Authorization: Bearer <token>` compartido entre front y back. El front obtiene el `discord_id` de la sesión del servidor | `API_BEARER_TOKEN` (en el front: `ADMIN_API_KEY`) |
| `/api/extension/*` | `Authorization: Bearer <JWT de extensión>` de 30 días, emitido tras el login con Discord | `EXTENSION_JWT_SECRET` |
| `/api/cron/*` | `Authorization: Bearer <secreto>` (lo envía Vercel Cron). Sin la variable, la ruta queda cerrada | `CRON_SECRET` |
| `/api/tasks/*` | Secreto propio de la tarea | `TIKTOK_LEADERBOARD_TASK_SECRET` |
| `/api/kick/live` | Pública | — |

Login del panel: `POST /api/auth/login` con `{ username, password }`. Logout: `POST /api/auth/logout`.

Los `state` de los OAuth de TikTok y Kick se firman con secretos derivados de `JWT_SECRET` (`src/lib/env.ts`, `derivedSecret`), de modo que no sirven como sesión de admin.

Ninguna variable tiene valor por defecto: si falta una, la petición falla.
