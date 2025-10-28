# API Authentication Documentation

## Sistema de Autenticación Simplificado

### Bearer Token para APIs

Todas las rutas API (excepto `/api/auth/login` y `/api/auth/logout`) requieren un Bearer token en el header Authorization.

#### Bearer Token:

```
Bearer_mateozshop_api_secret_2024_ultra_secure_token_xyz789
```

#### Ejemplo de request:

```bash
curl -X GET "http://localhost:3001/api/users" \
  -H "Authorization: Bearer Bearer_mateozshop_api_secret_2024_ultra_secure_token_xyz789"
```

### Páginas Web

- **Página pública**: `/login`
- **Páginas privadas**: Todas las demás (requieren JWT cookie)

### Rutas API por categoría:

#### APIs Sin Autenticación:

- `POST /api/auth/login` - Login del administrador
- `POST /api/auth/logout` - Logout del administrador

#### APIs Con Bearer Token:

- `GET /api/users` - Listar usuarios
- `GET /api/products` - Listar productos
- `GET /api/orders` - Listar pedidos
- `GET /api/giveaways` - Listar sorteos
- `POST /api/admin/*` - Todas las APIs de administración
- Y todas las demás rutas API

### Variables de Entorno Requeridas:

```env
JWT_SECRET=mateozshop_admin_secret_key_2024_super_secure_random_string
API_BEARER_TOKEN=Bearer_mateozshop_api_secret_2024_ultra_secure_token_xyz789
USER_NAME_ADMIN=mateozadminshop
USER_PASSWORD_ADMIN=WzNEjnU2xsLE
```

### Códigos de Error:

- `401` - Bearer token faltante o inválido
- `403` - JWT inválido o expirado (páginas web)
