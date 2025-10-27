# Sistema de Sorteos Automáticos

Este sistema permite revisar y procesar automáticamente los sorteos que han finalizado.

## Características

- ✅ Detección automática de sorteos finalizados
- ✅ Selección aleatoria de ganadores
- ✅ Procesamiento en lote de múltiples sorteos
- ✅ API endpoints para control manual
- ✅ Sistema de cron job para automatización
- ✅ Estadísticas y monitoreo

## Endpoints API

### 1. Procesar todos los sorteos finalizados

```
POST /api/giveaways/lottery
```

Procesa automáticamente todos los sorteos que han finalizado pero no tienen ganador.

**Respuesta de ejemplo:**

```json
{
  "success": true,
  "message": "Procesados 2 sorteos",
  "results": [
    {
      "success": true,
      "giveawayId": 1,
      "winner": {
        "id": 123,
        "username": "usuario1",
        "image": "avatar.jpg",
        "kickId": "kick123"
      },
      "totalParticipants": 45
    }
  ]
}
```

### 2. Realizar sorteo específico

```
POST /api/giveaways/[id]/lottery
```

Realiza el sorteo para un giveaway específico.

### 3. Obtener estadísticas

```
GET /api/giveaways/lottery
```

Obtiene estadísticas de todos los sorteos.

### 4. Cron Job (Automatización)

```
GET /api/cron/giveaways
```

Endpoint diseñado para ser ejecutado periódicamente por un cron job externo.

## Configuración

### Variables de Entorno

Añade estas variables a tu archivo `.env.local`:

```env
# Opcional: Token de seguridad para el cron job
CRON_SECRET=tu_token_secreto_aqui
```

### Configuración de Cron Job

Para automatizar completamente el sistema, configura un cron job externo que ejecute:

```bash
# Cada 5 minutos
*/5 * * * * curl -X GET "https://tu-dominio.com/api/cron/giveaways" -H "Authorization: Bearer tu_token_secreto_aqui"

# O cada hora
0 * * * * curl -X GET "https://tu-dominio.com/api/cron/giveaways" -H "Authorization: Bearer tu_token_secreto_aqui"
```

## Uso Manual

### Desde el código

```typescript
import {
  processFinishedGiveaways,
  performGiveawayLottery,
} from "@/app/utils/giveaways/lottery";

// Procesar todos los sorteos finalizados
const results = await processFinishedGiveaways();

// Realizar un sorteo específico
const result = await performGiveawayLottery(123);
```

### Desde la API

```bash
# Procesar todos los sorteos finalizados
curl -X POST "http://localhost:3000/api/giveaways/lottery"

# Realizar sorteo específico
curl -X POST "http://localhost:3000/api/giveaways/123/lottery"

# Obtener estadísticas
curl -X GET "http://localhost:3000/api/giveaways/lottery"
```

## Migración de Base de Datos

**IMPORTANTE**: Antes de usar este sistema, necesitas actualizar el esquema de la base de datos para que el campo `winner` sea nullable:

```bash
# Generar migración
npx drizzle-kit generate

# Aplicar migración
npx drizzle-kit push
```

El cambio en `src/db/schema.ts` ya está aplicado:

```typescript
winner: integer("winner").references(() => users.id, {
  onDelete: "set null",
  onUpdate: "cascade",
}),
```

## Monitoreo y Logs

El sistema incluye logging detallado:

- ✅ Logs de inicio y finalización de sorteos
- ✅ Información del ganador seleccionado
- ✅ Conteo de participantes
- ✅ Manejo de errores con detalles
- ✅ Timestamp de todas las operaciones

## Flujo de Trabajo

1. **Detección**: El sistema busca sorteos con `end_at < now` y `winner = null`
2. **Validación**: Verifica que hay participantes en el sorteo
3. **Sorteo**: Selecciona un ganador aleatorio de los participantes
4. **Actualización**: Actualiza la base de datos con el ganador
5. **Logging**: Registra el resultado del sorteo

## Ejemplos de Uso

### Automatización completa con Vercel Cron

Si usas Vercel, puedes configurar un cron job en `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/giveaways",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

### Integración con servicios externos

Usa webhooks o servicios como GitHub Actions para ejecutar periódicamente:

```yaml
name: Process Giveaways
on:
  schedule:
    - cron: "*/15 * * * *"

jobs:
  process-giveaways:
    runs-on: ubuntu-latest
    steps:
      - name: Process finished giveaways
        run: |
          curl -X GET "${{ secrets.APP_URL }}/api/cron/giveaways" \
               -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```
