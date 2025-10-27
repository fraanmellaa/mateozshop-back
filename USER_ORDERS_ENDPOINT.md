# Endpoint: Orders del Usuario

## Descripción

Obtiene todas las órdenes/pedidos de un usuario específico.

## Endpoint

```
GET /api/user/[discord_id]/orders
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
      "product_name": "Skin Valorant Phantom",
      "product_image": "https://example.com/phantom-skin.jpg",
      "cost": 150,
      "status": 1,
      "created_at": "2024-10-27T14:30:00.000Z"
    },
    {
      "id": 2,
      "product_name": "Riot Points 1000 RP",
      "product_image": "https://example.com/riot-points.jpg",
      "cost": 75,
      "status": 0,
      "created_at": "2024-10-26T10:15:00.000Z"
    }
  ]
}
```

## Estados de Orden

- `0`: Pendiente
- `1`: Completada
- `2`: Cancelada

## Campos de Respuesta

- `id`: ID único del pedido
- `product_name`: Nombre del artículo/producto
- `product_image`: URL de la foto del producto
- `cost`: Coste/precio del producto en puntos
- `status`: Estado del pedido (0=pendiente, 1=completada, 2=cancelada)
- `created_at`: Fecha de creación del pedido en formato ISO

## Ejemplo de Uso

```bash
# Obtener órdenes del usuario con Discord ID "123456789"
curl -X GET "http://localhost:3000/api/user/123456789/orders"
```

```javascript
// En el frontend
const fetchUserOrders = async (discordId) => {
  const response = await fetch(`/api/user/${discordId}/orders`);
  const data = await response.json();

  if (data.success) {
    return data.data;
  } else {
    throw new Error(data.error);
  }
};

// Función para obtener el texto del estado
const getOrderStatusText = (status) => {
  switch (status) {
    case 0:
      return "Pendiente";
    case 1:
      return "Completada";
    case 2:
      return "Cancelada";
    default:
      return "Desconocido";
  }
};
```

## Errores Posibles

- `404 USER_NOT_FOUND`: El usuario con el Discord ID proporcionado no existe
- `500`: Error interno del servidor

## Diferencias con la Versión Anterior

- ✅ **Añadido**: `cost` (precio del producto)
- ✅ **Reordenado**: Los campos ahora están en el orden solicitado
- ✅ **Removido**: `total` (se usa `cost` en su lugar)
- ✅ **Mantenido**: Todos los demás campos esenciales
