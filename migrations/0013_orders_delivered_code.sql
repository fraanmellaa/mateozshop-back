-- 0013: código entregado en cada pedido.
--
-- Aplicar a mano en el SQL editor de Supabase después de la 0012 (es
-- idempotente). Permite saber qué código se entregó en un pedido (canje o
-- subasta), reenviarlo si el email falló y decidir si al cancelar se repone
-- stock.

SET search_path TO public;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_code text;
-- NULL = el pedido no lleva código; true/false = resultado del último envío.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS code_email_sent boolean;

NOTIFY pgrst, 'reload schema';
