-- 0031: Categoría de los premios de la tienda.
--
-- Aplicar a mano en el SQL editor de Supabase. Es idempotente y no depende de
-- ninguna otra migración (solo de que exista la tabla `products`).
--
-- Añade `products.category`: clave de la categoría que el admin le pone a cada
-- premio para los filtros de la tienda ("Verificados", "Casino", "Tarjetas
-- regalo"...). NULL = sin categoría (el premio solo sale en "Todos"). La lista
-- de claves válidas la valida el back (src/app/utils/products/categories.ts);
-- aquí no se restringe para poder añadir categorías sin otra migración.
--
-- Mientras esta migración no esté aplicada, el back sigue funcionando sin
-- categorías: la tienda las devuelve vacías y el panel avisa al guardar una.

SET search_path TO public;

ALTER TABLE products ADD COLUMN IF NOT EXISTS category text;

-- Recarga la caché de esquema de PostgREST para que la API vea la columna ya.
NOTIFY pgrst, 'reload schema';
