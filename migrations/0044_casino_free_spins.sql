-- 0044 · Premios de tiradas de Casino Barcelona (categoría «Casino»)
--
-- Aplicar a mano en el SQL editor de Supabase, después de la 0043 y CUANDO LA
-- WEB NUEVA YA ESTÉ PUBLICADA con las tres imágenes en public/slots/: los
-- premios salen en la tienda en cuanto se ejecuta. Se puede ejecutar más de
-- una vez (no duplica premios).
--
-- Crea el grupo de stock «casino-barcelona-fs» (100 al mes, compartido) y sus
-- tres premios: Sweet Bonanza, Starlight Princess y Gates of Olympus. Cada uno
-- son 30 tiradas, sale en 3.000 puntos y se entrega por mensaje privado (el
-- ganador da su usuario de Casino Barcelona).
--
-- La web lee de aquí lo que enseña la tarjeta:
--   · nombre            → nombre de la slot
--   · descripción, 1.ª línea  → «Casino Barcelona · 30 tiradas» (de ese «30»
--                               sale la etiqueta «30 FS»)
--   · descripción, resto      → condiciones, en la ventana de puja
--   · imagen            → ruta dentro de la web pública (public/slots/)

SET search_path TO public;

INSERT INTO stock_groups (key, monthly_stock, month)
VALUES ('casino-barcelona-fs', 100, to_char(now() AT TIME ZONE 'Europe/Andorra', 'YYYY-MM'))
ON CONFLICT (key) DO NOTHING;

INSERT INTO products (
  name, description, image, price, stock,
  delivery_type, requires_trade_link, category, stock_group,
  is_auction, min_bid_increment, auction_ends_at, auction_reopens_at,
  auction_round, auction_status, auction_prize_assigned, auction_starting_notified,
  current_bid, current_bidder_user_id, sendable, codes, used_codes, created_at
)
SELECT
  v.name,
  'Casino Barcelona · 30 tiradas' || E'\n' ||
    'Para canjearlas necesitas cuenta verificada en Casino Barcelona y un depósito en los últimos 30 días.',
  v.image,
  3000,
  -- Lo que le quede al grupo este mes (100 la primera vez).
  COALESCE((SELECT min(p.stock) FROM products p WHERE p.stock_group = 'casino-barcelona-fs'), 100),
  'dm', false, 'casino', 'casino-barcelona-fs',
  true, 1, NULL, NULL,
  1, 'waiting', false, false,
  0, NULL, false, '[]'::jsonb, '[]'::jsonb, extract(epoch FROM now())::integer
FROM (
  VALUES
    ('Sweet Bonanza', '/slots/sweet-bonanza.jpg'),
    ('Starlight Princess', '/slots/starlight-princess.jpg'),
    ('Gates of Olympus', '/slots/gates-of-olympus.jpg')
) AS v(name, image)
WHERE NOT EXISTS (
  SELECT 1 FROM products p
   WHERE p.stock_group = 'casino-barcelona-fs' AND p.name = v.name
);
