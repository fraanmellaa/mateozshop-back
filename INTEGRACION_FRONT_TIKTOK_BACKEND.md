# Integracion del Front Externo con este Backend (TikTok)

Este documento explica todo lo necesario para conectar tu proyecto de frontend separado contra este backend y habilitar:

- Vinculacion de cuenta TikTok por usuario
- Lectura de metricas (seguidores, likes, etc.)
- Lectura de los ultimos 5 videos

## 1. Arquitectura recomendada

Para seguridad, no llames a este backend directamente desde el navegador con el bearer token.

Recomendado:

- Frontend (cliente) llama a endpoints internos de tu proyecto de front (BFF)
- BFF del frontend llama a este backend con Authorization Bearer

Asi evitas exponer API_BEARER_TOKEN al cliente.

## 2. Variables de entorno

### En este backend (ya existente)

Deben existir:

- TIKTOK_CLIENT_API_KEY
- TIKTOK_CLIENT_API_SECRET
- API_BEARER_TOKEN
- TIKTOK_REDIRECT_URI (opcional, pero recomendado)

### En el proyecto de frontend externo

Crea en el front:

- BACKEND_API_BASE_URL
- BACKEND_API_BEARER_TOKEN
- FRONT_TIKTOK_REDIRECT_URI

Ejemplo:

BACKEND_API_BASE_URL=https://tu-backend.com
BACKEND_API_BEARER_TOKEN=tu_token_backend
FRONT_TIKTOK_REDIRECT_URI=https://tu-frontend.com/tiktok/callback

Importante:

- FRONT_TIKTOK_REDIRECT_URI debe coincidir con el redirect URI configurado en TikTok Developer Portal
- Debe coincidir tambien con redirect_uri enviado al backend

## 3. Endpoints disponibles en este backend

Todos requieren header:

Authorization: Bearer TU_API_BEARER_TOKEN

### 3.1 Obtener URL de autorizacion TikTok

GET /api/user/:discordId/tiktok/auth-url?redirect_uri=...

Respuesta:

- auth_url
- state (obligatorio para PKCE en el paso connect)
- redirect_uri
- scopes

### 3.2 Conectar cuenta TikTok (code exchange)

POST /api/user/:discordId/tiktok/connect

Body JSON:

{
  "code": "CODE_DE_TIKTOK",
  "redirect_uri": "https://tu-frontend.com/tiktok/callback",
  "state": "STATE_DEVUELTO_POR_AUTH_URL"
}

### 3.3 Estado rapido de vinculacion

GET /api/user/:discordId/tiktok/status

### 3.4 Perfil + metricas TikTok

GET /api/user/:discordId/tiktok

Incluye, entre otros:

- follower_count
- following_count
- likes_count
- video_count

### 3.5 Videos recientes

GET /api/user/:discordId/tiktok/videos?limit=5

- limit opcional
- minimo 1
- maximo 20
- recomendado para tu caso: 5

### 3.6 Desvincular cuenta

DELETE /api/user/:discordId/tiktok

## 4. Flujo funcional completo (front separado)

1. Usuario hace clic en Vincular TikTok
2. Tu front llama a su BFF interno, y ese BFF llama:
   - GET /api/user/:discordId/tiktok/auth-url
3. Tu front redirige a auth_url (TikTok OAuth)
4. TikTok redirige a tu callback del front con code y state
5. Tu front envia code y state a su BFF
6. Tu BFF llama a:
   - POST /api/user/:discordId/tiktok/connect
7. Si OK, tu front consulta:
   - GET /api/user/:discordId/tiktok
   - GET /api/user/:discordId/tiktok/videos?limit=5
8. Renderizas metricas y videos

## 5. Ejemplo de cliente servidor (BFF) en el proyecto de front

Ejemplo TypeScript para usar en rutas server del front:

```ts
const API_BASE = process.env.BACKEND_API_BASE_URL!;
const API_TOKEN = process.env.BACKEND_API_BEARER_TOKEN!;

async function backendFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || data?.message || "Backend request failed");
  }
  return data;
}
```

### 5.1 Pedir auth_url

```ts
export async function getTikTokAuthUrl(discordId: string) {
  const redirect = encodeURIComponent(process.env.FRONT_TIKTOK_REDIRECT_URI!);
  return backendFetch(`/api/user/${discordId}/tiktok/auth-url?redirect_uri=${redirect}`);
}
```

### 5.2 Conectar con code/state

```ts
export async function connectTikTok(discordId: string, code: string, state: string) {
  return backendFetch(`/api/user/${discordId}/tiktok/connect`, {
    method: "POST",
    body: JSON.stringify({
      code,
      state,
      redirect_uri: process.env.FRONT_TIKTOK_REDIRECT_URI,
    }),
  });
}
```

### 5.3 Obtener perfil y videos

```ts
export async function getTikTokProfile(discordId: string) {
  return backendFetch(`/api/user/${discordId}/tiktok`);
}

export async function getTikTokVideos(discordId: string) {
  return backendFetch(`/api/user/${discordId}/tiktok/videos?limit=5`);
}
```

## 6. Pagina callback en el front

En tu callback:

- Lee query params code y state
- Obtiene el discordId del usuario logeado
- Llama a tu endpoint interno de front que haga connectTikTok
- Redirige a la pantalla de perfil/conexion

Validaciones minimas:

- Si falta code o state: mostrar error
- Si connect falla: mostrar mensaje y opcion de reintentar

Nota PKCE:

- Este backend genera y valida PKCE automaticamente (code_challenge y code_verifier).
- El frontend solo debe reenviar exactamente el state recibido en auth-url al endpoint connect.

## 7. Errores comunes y solucion

### Redirect URI mismatch

Sintoma:

- TikTok devuelve error en intercambio de code

Revision:

- redirect_uri del auth-url y del connect debe ser exactamente el mismo
- Debe coincidir con TikTok Developer Portal

### Usuario no encontrado

Sintoma:

- USER_NOT_FOUND

Revision:

- El discordId enviado debe existir en este backend

### TIKTOK_NOT_LINKED

Sintoma:

- Al pedir videos/perfil, devuelve no vinculado

Revision:

- Completar primero el paso de connect

### Token expirado

El backend ya refresca token automaticamente cuando hace falta.

## 8. Checklist de puesta en marcha

1. Configurar envs en backend y frontend
2. Confirmar redirect URI en TikTok Developer Portal
3. Confirmar que frontend usa llamadas server-side (BFF)
4. Probar flujo:
   - auth-url
   - callback con code/state
   - connect
   - profile
   - videos (limit=5)
5. Probar unlink

## 9. Contrato esperado de tu frontend

Input minimo por usuario:

- discordId del usuario

Output esperado en UI:

- Estado vinculado o no
- Perfil TikTok
- Metricas de cuenta
- Ultimos 5 videos

## 10. Referencias

Documentacion implementada:

- OAuth token management
- Display API user info
- Display API video list

Este backend ya deja montada la base para evolucionar luego a:

- Paginacion de videos con cursor
- Sincronizacion periodica en jobs
- Cache de metricas para dashboards
