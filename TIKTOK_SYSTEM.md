# TikTok Server Integration

Base backend implemented to connect a TikTok account to a user account in this API.

## Required environment variables

- TIKTOK_CLIENT_API_KEY
- TIKTOK_CLIENT_API_SECRET
- TIKTOK_REDIRECT_URI (optional, can be sent by frontend on each request)
- API_BEARER_TOKEN

## Scopes requested

- user.info.basic
- user.info.profile
- user.info.stats
- video.list

## Data model

Table: user_tiktok_accounts

- One row per local user (user_id unique)
- Stores open_id, profile cache, scopes, access token and refresh token
- Stores absolute expiration timestamps

## API endpoints

All endpoints below require Authorization header with API bearer token.

### 1) Get TikTok authorization URL

GET /api/user/:discordId/tiktok/auth-url?redirect_uri=https://your-frontend/callback

Response:

- auth_url: TikTok OAuth URL
- state: signed short-lived token (10 min), required for PKCE
- redirect_uri
- scopes

### 2) Connect account using code from TikTok callback

POST /api/user/:discordId/tiktok/connect

Body:

- code: authorization code from TikTok
- redirect_uri: optional if TIKTOK_REDIRECT_URI is configured
- state: required, must be the same value returned by auth-url

What it does:

- Exchanges code for access and refresh token
- Calls user info API
- Upserts connection in DB

### 3) Get link status (fast, DB only)

GET /api/user/:discordId/tiktok/status

### 4) Get profile + metrics (live from TikTok)

GET /api/user/:discordId/tiktok

Returns account info including:

- follower_count
- following_count
- likes_count
- video_count

### 5) Get latest videos (default 5)

GET /api/user/:discordId/tiktok/videos?limit=5

- limit optional, min 1 max 20
- returns videos list, cursor, has_more

### 6) Unlink TikTok account

DELETE /api/user/:discordId/tiktok

- Tries TikTok revoke endpoint (best effort)
- Always removes local DB linkage

## Recommended frontend flow (separate frontend project)

1. Call auth-url endpoint and redirect user to auth_url.
2. Frontend callback receives code and state.
3. Call connect endpoint with code + state.
4. Query profile endpoint and videos endpoint.

## Notes

- Access token auto-refresh is done server-side when close to expiry.
- API currently keeps cached profile fields in DB but serves live stats when available.
