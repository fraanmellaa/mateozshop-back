# Endpoint: Sorteos del Usuario

## Descripción

Obtiene todos los sorteos en los que está participando un usuario específico.

## Endpoint

```
GET /api/user/[discord_id]/giveaways
```

## Parámetros

- `discord_id` (string): El Discord ID del usuario

## Respuesta de Ejemplo

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "Sorteo PlayStation 5",
      "image": "https://example.com/ps5.jpg",
      "cost": 100,
      "status": "active",
      "tickets": 5,
      "isWinner": false,
      "start_at": 1730025600,
      "end_at": 1730112000,
      "created_at": "2024-10-27T00:00:00.000Z"
    },
    {
      "id": 2,
      "title": "Sorteo Nintendo Switch",
      "image": "https://example.com/switch.jpg",
      "cost": 50,
      "status": "finished",
      "tickets": 3,
      "isWinner": true,
      "start_at": 1729939200,
      "end_at": 1730025600,
      "created_at": "2024-10-26T00:00:00.000Z"
    }
  ]
}
```

## Estados Posibles

- `upcoming`: El sorteo aún no ha comenzado
- `active`: El sorteo está activo (se puede participar)
- `pending`: El sorteo ha finalizado pero aún no se ha realizado el sorteo
- `finished`: El sorteo ha finalizado y ya tiene ganador

## Campos de Respuesta

- `id`: ID único del sorteo
- `title`: Nombre del sorteo
- `image`: URL de la imagen del premio
- `cost`: Costo en puntos para participar
- `status`: Estado actual del sorteo
- `tickets`: Cantidad de tickets que tiene el usuario en este sorteo
- `isWinner`: true si el usuario es el ganador (solo relevante en status "finished")
- `start_at`: Timestamp de inicio del sorteo
- `end_at`: Timestamp de finalización del sorteo
- `created_at`: Fecha de inicio en formato ISO

## Ejemplo de Uso

```bash
# Obtener sorteos del usuario con Discord ID "123456789"
curl -X GET "http://localhost:3000/api/user/123456789/giveaways"
```

```javascript
// En el frontend
const fetchUserGiveaways = async (discordId) => {
  const response = await fetch(`/api/user/${discordId}/giveaways`);
  const data = await response.json();

  if (data.success) {
    return data.data;
  } else {
    throw new Error(data.error);
  }
};
```

## Errores Posibles

- `404 USER_NOT_FOUND`: El usuario con el Discord ID proporcionado no existe
- `500`: Error interno del servidor
