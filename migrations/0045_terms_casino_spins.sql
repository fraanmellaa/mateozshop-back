-- 0045 · Términos, punto 6: las tiradas de casino sí pueden exigir depósito
--
-- Aplicar a mano en el SQL editor de Supabase. Se puede ejecutar más de una
-- vez: solo toca el texto si todavía tiene la frase antigua.
--
-- Los premios de tiradas de Casino Barcelona (0044) piden cuenta verificada y
-- un depósito en los últimos 30 días para canjearse. El punto 6 de los
-- Términos decía «No es necesario depositar ni jugar» sin excepciones; pasa a
-- «Salvo en las tiradas de casino, no es necesario depositar ni jugar».
--
-- Si los Términos no están guardados en la base de datos (la web usa entonces
-- su texto por defecto, que ya lleva el cambio), no hace nada.

SET search_path TO public;

UPDATE legal_pages
   SET body = regexp_replace(
         replace(
           body,
           'No es necesario depositar ni jugar.',
           'Salvo en las tiradas de casino, no es necesario depositar ni jugar.'
         ),
         'Última actualización: [^.\n]*\.',
         'Última actualización: 25 de noviembre de 2026.'
       ),
       updated_at = extract(epoch FROM now())::integer
 WHERE slug = 'terminos'
   AND body LIKE '%No es necesario depositar ni jugar.%'
   AND body NOT LIKE '%Salvo en las tiradas de casino, no es necesario depositar ni jugar.%';
