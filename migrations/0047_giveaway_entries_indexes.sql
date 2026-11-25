-- 0047 · Índices de las entradas de sorteos
--
-- Aplicar a mano en el SQL editor de Supabase. Se puede ejecutar más de una
-- vez. Solo añade índices: no cambia datos ni funciones.
--
-- `giveaways_entries` guarda una fila por ticket y solo tenía la clave
-- primaria. Todo lo que la lee filtra por sorteo o por usuario (lista de
-- participantes, recuento de tickets, «mis sorteos», el propio sorteo), así
-- que cada lectura recorría la tabla entera. Con pocos tickets no se nota;
-- con miles por sorteo, sí.
--
-- Los índices se crean sin CONCURRENTLY porque el editor de Supabase ejecuta
-- dentro de una transacción; con la tabla actual es instantáneo.

SET search_path TO public;

-- Participantes y recuento de un sorteo, en orden de entrada.
CREATE INDEX IF NOT EXISTS giveaways_entries_giveaway_idx
  ON giveaways_entries (giveaway_id, id);

-- Sorteos en los que participa un usuario.
CREATE INDEX IF NOT EXISTS giveaways_entries_user_idx
  ON giveaways_entries (user_id, giveaway_id);
