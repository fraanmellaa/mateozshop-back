-- Datos de EJEMPLO para ver la tienda de puntos funcionando con el sistema nuevo.
--
-- Ejecutar a mano en el SQL editor de Supabase DESPUÉS de las migraciones
-- 0012 → 0025. Se puede ejecutar varias veces: cada fila solo se inserta si
-- no existe ya otra con el mismo nombre/título.
--
-- Todo son valores de ejemplo: las imágenes son marcadores de posición
-- (placehold.co), los precios están pensados para la economía del encargo
-- (10 puntos por minuto escribiendo en el chat durante el directo) y las
-- fechas arrancan "ahora". Cámbialos o bórralos desde el panel antes de abrir
-- la tienda al público. Los casinos de /bonuses los crea la migración 0016/0025.
--
-- Los premios de verdad (los decide Mateo) se cargan desde el panel.

SET search_path TO public;

-- ───────────────────────── tienda (todo por pujas) ─────────────────────────
-- `price` es la PUJA MÍNIMA. Cada premio nace esperando la primera puja
-- ("waiting"): esa puja abre la batalla de 30 min.
-- `value_eur` > 25 € obliga a revisión manual antes de entregar.
-- delivery_type: 'code' (código por email), 'dm' (mensaje privado), 'trade'
-- (enlace de intercambio de Steam; el ganador necesita guardar el suyo).

INSERT INTO products
  (name, image, price, created_at, description, stock, codes, used_codes,
   is_auction, auction_status, current_bid, value_eur, delivery_type, requires_trade_link)
SELECT v.name, v.image, v.price, extract(epoch FROM now())::integer, v.description,
       v.stock, '[]'::jsonb, '[]'::jsonb,
       true, 'waiting', 0, v.value_eur, v.delivery_type, v.requires_trade_link
FROM (VALUES
  ('Pack de stickers de MateoZ',
   'https://placehold.co/600x400/6d28d9/ffffff/png?text=Stickers',
   1000, 'Pack de stickers digitales de MateoZ. Se entrega por mensaje privado.',
   20, 2.00::numeric, 'dm', false),
  ('Rol VIP en Discord (1 mes)',
   'https://placehold.co/600x400/2563eb/ffffff/png?text=Rol+VIP',
   3000, 'Rol VIP exclusivo en el Discord durante un mes.',
   10, 5.00::numeric, 'dm', false),
  ('Mención en directo',
   'https://placehold.co/600x400/db2777/ffffff/png?text=Mencion+en+directo',
   6000, 'MateoZ te menciona y te saluda en un directo.',
   5, 5.00::numeric, 'dm', false),
  ('Skin de CS2 (ejemplo)',
   'https://placehold.co/600x400/0f766e/ffffff/png?text=Skin+CS2',
   15000, 'Skin de ejemplo. Se entrega por enlace de intercambio de Steam: guarda el tuyo en tu perfil antes de pujar.',
   3, 10.00::numeric, 'trade', true),
  ('Tarjeta Steam 25 €',
   'https://placehold.co/600x400/1d4ed8/ffffff/png?text=Tarjeta+Steam+25',
   40000, 'Tarjeta regalo de Steam de 25 €. Se entrega por mensaje privado.',
   2, 25.00::numeric, 'dm', false),
  ('Tarjeta Steam 50 € (revisión manual)',
   'https://placehold.co/600x400/7c3aed/ffffff/png?text=Tarjeta+Steam+50',
   80000, 'Premio de más de 25 €: antes de entregarlo lo revisa el equipo.',
   1, 50.00::numeric, 'dm', false)
) AS v(name, image, price, description, stock, value_eur, delivery_type, requires_trade_link)
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = v.name);

-- ───────────────────────── sorteos ─────────────────────────
-- Cada ticket cuesta `cost` puntos. El ganador se elige de forma verificable:
-- al crear el sorteo se publica el hash de la semilla (se genera solo) y al
-- sortear se revela la semilla. Las bases de cada sorteo van en `rules`.

INSERT INTO giveaways (cost, title, image, start_at, end_at, rules)
SELECT v.cost, v.title, v.image,
       extract(epoch FROM now())::integer,
       extract(epoch FROM now() + interval '7 days')::integer,
       v.rules
FROM (VALUES
  (500, 'Sorteo Tarjeta Steam 10 € (ejemplo)',
   'https://placehold.co/600x400/1d4ed8/ffffff/png?text=Tarjeta+Steam+10',
   'Bases de ejemplo: cada ticket es una participación. Puedes comprar varios. El ganador se elige al azar de forma verificable entre todos los tickets cuando termina el sorteo. Premio digital, entregado por mensaje privado. Sustituye este texto por las bases reales.'),
  (1500, 'Sorteo Skin de CS2 (ejemplo)',
   'https://placehold.co/600x400/be123c/ffffff/png?text=Skin+CS2',
   'Bases de ejemplo: cada ticket es una participación. El ganador se elige al azar de forma verificable. El premio se entrega por enlace de intercambio de Steam. Sustituye este texto por las bases reales.')
) AS v(cost, title, image, rules)
WHERE NOT EXISTS (SELECT 1 FROM giveaways g WHERE g.title = v.title);

-- ───────────────────────── cajas ─────────────────────────
-- Probabilidades por categoría en puntos básicos (suman 10000): común 70 %,
-- raro 22 %, épico 7 %, legendario 1 %. Quedan activas.
-- Un premio con stock que se agota entrega `fallback_points` puntos en su
-- lugar (obligatorio cuando hay stock). Los premios de puntos están
-- calculados para que, de media, la caja devuelva bastante menos de lo que
-- cuesta (≈ 48 % en la Básica y ≈ 50 % en la Premium, sin contar los objetos).
-- Los premios `item` quedan pendientes de entrega en la pestaña "Entregas".

INSERT INTO loot_boxes
  (name, description, image, price, weight_common, weight_rare, weight_epic, weight_legendary,
   position, is_active, created_at, updated_at)
SELECT v.name, v.description, v.image, v.price, 7000, 2200, 700, 100,
       v.position, true, extract(epoch FROM now())::integer, extract(epoch FROM now())::integer
FROM (VALUES
  ('Caja Básica',
   'La caja de todos los días: puntos y, con suerte, algo exclusivo.',
   'https://placehold.co/600x400/334155/ffffff/png?text=Caja+Basica', 500, 1),
  ('Caja Premium',
   'Premios más gordos: puntos, free spins patrocinados y más.',
   'https://placehold.co/600x400/b45309/ffffff/png?text=Caja+Premium', 2500, 2)
) AS v(name, description, image, price, position)
WHERE NOT EXISTS (SELECT 1 FROM loot_boxes b WHERE b.name = v.name);

INSERT INTO loot_box_prizes
  (box_id, rarity, kind, name, description, image, points, weight, stock, fallback_points,
   is_active, position, created_at, updated_at)
SELECT b.id, v.rarity, v.kind, v.name, v.description, v.image, v.points, v.weight, v.stock,
       v.fallback_points, true, v.position,
       extract(epoch FROM now())::integer, extract(epoch FROM now())::integer
FROM (VALUES
  -- Caja Básica
  ('Caja Básica', 'common',    'points', '50 puntos',   NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=50+pts',     50,   3, NULL::integer, NULL::integer, 1),
  ('Caja Básica', 'common',    'points', '100 puntos',  NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=100+pts',   100,   2, NULL::integer, NULL::integer, 2),
  ('Caja Básica', 'common',    'points', '150 puntos',  NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=150+pts',   150,   1, NULL::integer, NULL::integer, 3),
  ('Caja Básica', 'rare',      'points', '400 puntos',  NULL::text, 'https://placehold.co/400x400/2563eb/ffffff/png?text=400+pts',   400,   2, NULL::integer, NULL::integer, 4),
  ('Caja Básica', 'rare',      'points', '700 puntos',  NULL::text, 'https://placehold.co/400x400/2563eb/ffffff/png?text=700+pts',   700,   1, NULL::integer, NULL::integer, 5),
  ('Caja Básica', 'epic',      'points', '1.500 puntos', NULL::text, 'https://placehold.co/400x400/7c3aed/ffffff/png?text=1500+pts', 1500,  2, NULL::integer, NULL::integer, 6),
  ('Caja Básica', 'epic',      'item',   'Rol VIP en Discord (1 mes)', 'Se entrega manualmente.',
                                          'https://placehold.co/400x400/7c3aed/ffffff/png?text=Rol+VIP', NULL::integer, 1, 20, 1500, 7),
  ('Caja Básica', 'legendary', 'item',   '50 free spins (patrocinado)', 'Free spins de casino patrocinados. Se entregan manualmente.',
                                          'https://placehold.co/400x400/f59e0b/ffffff/png?text=50+free+spins', NULL::integer, 1, 10, 3000, 8),
  -- Caja Premium
  ('Caja Premium', 'common',    'points', '250 puntos',   NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=250+pts',   250,  3, NULL::integer, NULL::integer, 1),
  ('Caja Premium', 'common',    'points', '500 puntos',   NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=500+pts',   500,  2, NULL::integer, NULL::integer, 2),
  ('Caja Premium', 'common',    'points', '750 puntos',   NULL::text, 'https://placehold.co/400x400/64748b/ffffff/png?text=750+pts',   750,  1, NULL::integer, NULL::integer, 3),
  ('Caja Premium', 'rare',      'points', '2.000 puntos', NULL::text, 'https://placehold.co/400x400/2563eb/ffffff/png?text=2000+pts', 2000,  1, NULL::integer, NULL::integer, 4),
  ('Caja Premium', 'rare',      'points', '3.000 puntos', NULL::text, 'https://placehold.co/400x400/2563eb/ffffff/png?text=3000+pts', 3000,  1, NULL::integer, NULL::integer, 5),
  ('Caja Premium', 'epic',      'points', '6.000 puntos', NULL::text, 'https://placehold.co/400x400/7c3aed/ffffff/png?text=6000+pts', 6000,  1, NULL::integer, NULL::integer, 6),
  ('Caja Premium', 'legendary', 'item',   '200 free spins (patrocinado)', 'Free spins de casino patrocinados. Se entregan manualmente.',
                                           'https://placehold.co/400x400/f59e0b/ffffff/png?text=200+free+spins', NULL::integer, 3, 5, 8000, 7),
  ('Caja Premium', 'legendary', 'item',   'Tarjeta Steam 10 €', 'Se entrega manualmente por mensaje privado.',
                                           'https://placehold.co/400x400/f59e0b/ffffff/png?text=Tarjeta+Steam+10', NULL::integer, 1, 3, 8000, 8)
) AS v(box_name, rarity, kind, name, description, image, points, weight, stock, fallback_points, position)
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
  (1, 'Tarjeta Steam 25 €'),
  (2, 'Tarjeta Steam 10 €'),
  (3, '5.000 puntos')
) AS v(position, reward)
JOIN tiktok_leaderboards l ON l.title = 'Concurso TikTok semanal'
WHERE NOT EXISTS (
  SELECT 1 FROM tiktok_leaderboard_prizes p
  WHERE p.leaderboard_id = l.id AND p.position = v.position
);

-- ───────────────────────── pronósticos ─────────────────────────
-- Un pronóstico de ejemplo (publicado) para ver la página /predicciones.
-- Bórralo desde el panel antes de abrir al público.

INSERT INTO predictions (title, body, sport, league, pick, odds, event_at, published_at, is_published, source, created_at, updated_at)
SELECT 'Pronóstico de ejemplo (borrar antes de publicar)',
       'Texto de ejemplo para ver cómo se muestra un análisis. Aquí iría el razonamiento del pronóstico.',
       'Fútbol', 'LaLiga', 'Más de 1,5 goles', 1.45,
       extract(epoch FROM now() + interval '2 days')::integer,
       extract(epoch FROM now())::integer, true, 'admin',
       extract(epoch FROM now())::integer, extract(epoch FROM now())::integer
WHERE NOT EXISTS (
  SELECT 1 FROM predictions WHERE title = 'Pronóstico de ejemplo (borrar antes de publicar)'
);
