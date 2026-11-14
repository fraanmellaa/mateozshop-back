-- Datos de EJEMPLO para ver la tienda de puntos funcionando.
--
-- Ejecutar a mano en el SQL editor de Supabase DESPUÉS de las migraciones
-- 0012 → 0017. Se puede ejecutar varias veces: cada fila solo se inserta si
-- no existe ya otra con el mismo nombre/título.
--
-- Todo son valores de ejemplo: las imágenes son marcadores de posición
-- (placehold.co), los precios son orientativos y las fechas arrancan "ahora".
-- Cámbialos o bórralos desde el panel antes de abrir la tienda al público.
-- Los 7 casinos de /bonuses ya los crea la migración 0016.

SET search_path TO public;

-- ───────────────────────── productos normales ─────────────────────────

INSERT INTO products
  (name, image, price, created_at, description, stock, codes, used_codes, sendable, is_auction)
SELECT v.name, v.image, v.price, extract(epoch FROM now())::integer,
       v.description, v.stock, v.codes, '[]'::jsonb, v.sendable, false
FROM (VALUES
  ('Pack de stickers digitales',
   'https://placehold.co/600x400/6d28d9/ffffff/png?text=Stickers',
   300, 'Pack de stickers de MateoZ para usar en Discord.', 100, '[]'::jsonb, false),
  ('Rol VIP en Discord (1 mes)',
   'https://placehold.co/600x400/2563eb/ffffff/png?text=Rol+VIP',
   800, 'Rol VIP exclusivo en el Discord durante un mes.', 50, '[]'::jsonb, false),
  ('Mención en directo',
   'https://placehold.co/600x400/db2777/ffffff/png?text=Mencion+en+directo',
   1500, 'MateoZ te menciona y te saluda en un directo.', 20, '[]'::jsonb, false),
  ('Camiseta MateoZ',
   'https://placehold.co/600x400/0f766e/ffffff/png?text=Camiseta',
   6000, 'Camiseta oficial de MateoZ. Te contactaremos para el envío.', 10, '[]'::jsonb, false),
  ('Código de ejemplo (borrar antes de publicar)',
   'https://placehold.co/600x400/475569/ffffff/png?text=Entrega+automatica',
   100, 'Producto de ejemplo con entrega automática por email: sirve para probar el canje con código. Bórralo antes de abrir la tienda.', 3,
   '["DEMO-0001","DEMO-0002","DEMO-0003"]'::jsonb, true)
) AS v(name, image, price, description, stock, codes, sendable)
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = v.name);

-- ───────────────────────── subastas ─────────────────────────
-- Los puntos se retienen al pujar. La primera puja debe ser al menos el
-- precio de salida; cada puja siguiente, la actual + el incremento mínimo.
-- Al terminar, el cron adjudica y abre la siguiente ronda tras el enfriamiento.

INSERT INTO products
  (name, image, price, created_at, description, stock, codes, used_codes, sendable,
   is_auction, min_bid_increment, auction_ends_at, current_bid,
   auction_duration_seconds, auction_cooldown_seconds)
SELECT v.name, v.image, v.price, extract(epoch FROM now())::integer,
       v.description, 1, '[]'::jsonb, '[]'::jsonb, false,
       true, v.increment, extract(epoch FROM now() + interval '7 days')::integer, v.price,
       86400, 300
FROM (VALUES
  ('Skin exclusiva (subasta)',
   'https://placehold.co/600x400/f59e0b/ffffff/png?text=Skin+exclusiva',
   1000, 100, 'Skin exclusiva. Gana el mejor postor al cierre de la subasta.'),
  ('Sudadera MateoZ firmada (subasta)',
   'https://placehold.co/600x400/7c3aed/ffffff/png?text=Sudadera+firmada',
   3000, 250, 'Sudadera firmada por MateoZ. Te contactaremos para el envío.')
) AS v(name, image, price, increment, description)
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = v.name);

-- ───────────────────────── sorteos ─────────────────────────
-- Cada ticket cuesta `cost` puntos; el cron sortea al llegar `end_at`.

INSERT INTO giveaways (cost, title, image, start_at, end_at)
SELECT v.cost, v.title, v.image,
       extract(epoch FROM now())::integer,
       extract(epoch FROM now() + interval '7 days')::integer
FROM (VALUES
  (100, 'Sorteo Gift Card Steam 25€',
   'https://placehold.co/600x400/1d4ed8/ffffff/png?text=Gift+Card+Steam'),
  (250, 'Sorteo Auriculares gaming',
   'https://placehold.co/600x400/be123c/ffffff/png?text=Auriculares')
) AS v(cost, title, image)
WHERE NOT EXISTS (SELECT 1 FROM giveaways g WHERE g.title = v.title);

-- ───────────────────────── cajas ─────────────────────────
-- Probabilidades por categoría en puntos básicos (suman 10000):
-- común 70 %, raro 22 %, épico 7 %, legendario 1 %. Quedan activas.
-- Los premios de puntos están calculados para que, de media, la caja devuelva
-- bastante menos de lo que cuesta (la parte alta son objetos exclusivos).
-- Los premios `item` (free spins patrocinados, camiseta...) quedan pendientes
-- de entrega en la pestaña "Entregas" del panel.

INSERT INTO loot_boxes
  (name, description, image, price, weight_common, weight_rare, weight_epic, weight_legendary,
   position, is_active, created_at, updated_at)
SELECT v.name, v.description, v.image, v.price, 7000, 2200, 700, 100,
       v.position, true, extract(epoch FROM now())::integer, extract(epoch FROM now())::integer
FROM (VALUES
  ('Caja Básica',
   'La caja de todos los días: puntos y, con suerte, algo exclusivo.',
   'https://placehold.co/600x400/334155/ffffff/png?text=Caja+Basica', 200, 1),
  ('Caja Premium',
   'Premios más gordos: puntos, free spins patrocinados y merch exclusivo.',
   'https://placehold.co/600x400/b45309/ffffff/png?text=Caja+Premium', 1000, 2)
) AS v(name, description, image, price, position)
WHERE NOT EXISTS (SELECT 1 FROM loot_boxes b WHERE b.name = v.name);

INSERT INTO loot_box_prizes
  (box_id, rarity, kind, name, description, image, points, weight, stock, is_active,
   position, created_at, updated_at)
SELECT b.id, v.rarity, v.kind, v.name, v.description, v.image, v.points, v.weight, v.stock, true,
       v.position, extract(epoch FROM now())::integer, extract(epoch FROM now())::integer
FROM (VALUES
  -- Caja Básica
  ('Caja Básica', 'common',    'points', '20 puntos',  NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=20+pts',   20,   3, NULL::integer, 1),
  ('Caja Básica', 'common',    'points', '40 puntos',  NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=40+pts',   40,   2, NULL::integer, 2),
  ('Caja Básica', 'common',    'points', '60 puntos',  NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=60+pts',   60,   1, NULL::integer, 3),
  ('Caja Básica', 'rare',      'points', '150 puntos', NULL::text, 'https://placehold.co/400x400/2563eb/ffffff/png?text=150+pts',  150,  2, NULL::integer, 4),
  ('Caja Básica', 'rare',      'points', '250 puntos', NULL::text, 'https://placehold.co/400x400/2563eb/ffffff/png?text=250+pts',  250,  1, NULL::integer, 5),
  ('Caja Básica', 'epic',      'points', '600 puntos', NULL::text, 'https://placehold.co/400x400/7c3aed/ffffff/png?text=600+pts',  600,  2, NULL::integer, 6),
  ('Caja Básica', 'epic',      'item',   'Rol VIP en Discord (1 mes)', 'Se entrega manualmente.',
                                         'https://placehold.co/400x400/7c3aed/ffffff/png?text=Rol+VIP', NULL::integer, 1, 20, 7),
  ('Caja Básica', 'legendary', 'item',   '50 free spins (patrocinado)', 'Free spins de casino patrocinados. Se entregan manualmente.',
                                         'https://placehold.co/400x400/f59e0b/ffffff/png?text=50+free+spins', NULL::integer, 1, 10, 8),
  -- Caja Premium
  ('Caja Premium', 'common',    'points', '100 puntos',  NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=100+pts',  100,  3, NULL::integer, 1),
  ('Caja Premium', 'common',    'points', '200 puntos',  NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=200+pts',  200,  2, NULL::integer, 2),
  ('Caja Premium', 'common',    'points', '300 puntos',  NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=300+pts',  300,  1, NULL::integer, 3),
  ('Caja Premium', 'rare',      'points', '800 puntos',  NULL::text, 'https://placehold.co/400x400/2563eb/ffffff/png?text=800+pts',  800,  1, NULL::integer, 4),
  ('Caja Premium', 'rare',      'points', '1.200 puntos', NULL::text, 'https://placehold.co/400x400/2563eb/ffffff/png?text=1200+pts', 1200, 1, NULL::integer, 5),
  ('Caja Premium', 'epic',      'points', '2.500 puntos', NULL::text, 'https://placehold.co/400x400/7c3aed/ffffff/png?text=2500+pts', 2500, 1, NULL::integer, 6),
  ('Caja Premium', 'legendary', 'item',   '200 free spins (patrocinado)', 'Free spins de casino patrocinados. Se entregan manualmente.',
                                          'https://placehold.co/400x400/f59e0b/ffffff/png?text=200+free+spins', NULL::integer, 3, 5, 7),
  ('Caja Premium', 'legendary', 'item',   'Camiseta exclusiva MateoZ', 'Edición exclusiva. Te contactaremos para el envío.',
                                          'https://placehold.co/400x400/f59e0b/ffffff/png?text=Camiseta+exclusiva', NULL::integer, 1, 3, 8)
) AS v(box_name, rarity, kind, name, description, image, points, weight, stock, position)
JOIN loot_boxes b ON b.name = v.box_name
WHERE NOT EXISTS (
  SELECT 1 FROM loot_box_prizes p WHERE p.box_id = b.id AND p.name = v.name
);

-- ───────────────────────── concurso de TikTok ─────────────────────────
-- Un concurso activo durante 7 días con tres premios (el premio es texto
-- libre; la entrega la haces tú desde el panel al cerrarlo).

INSERT INTO tiktok_leaderboards (title, description, start_at, end_at, status, created_at, updated_at)
SELECT 'Concurso TikTok semanal',
       'El vídeo con más visualizaciones publicado durante la semana gana. Vincula tu TikTok y asocia tu vídeo.',
       extract(epoch FROM now())::integer,
       extract(epoch FROM now() + interval '7 days')::integer,
       'active',
       extract(epoch FROM now())::integer,
       extract(epoch FROM now())::integer
WHERE NOT EXISTS (SELECT 1 FROM tiktok_leaderboards WHERE title = 'Concurso TikTok semanal');

INSERT INTO tiktok_leaderboard_prizes (leaderboard_id, position, reward, created_at)
SELECT l.id, v.position, v.reward, extract(epoch FROM now())::integer
FROM (VALUES
  (1, 'Gift Card Steam 25€'),
  (2, 'Gift Card Steam 10€'),
  (3, '5.000 puntos')
) AS v(position, reward)
JOIN tiktok_leaderboards l ON l.title = 'Concurso TikTok semanal'
WHERE NOT EXISTS (
  SELECT 1 FROM tiktok_leaderboard_prizes p
  WHERE p.leaderboard_id = l.id AND p.position = v.position
);
