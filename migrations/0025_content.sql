-- 0025: contenido (encargo del 14 nov 2026): bonos destacados y con condiciones,
-- pronósticos deportivos (con Telegram) y textos legales editables.
--
-- Aplicar a mano en el SQL editor de Supabase. Es idempotente.

SET search_path TO public;

-- ───────────────────────── bonos ─────────────────────────
-- Semántica nueva de countries: países donde el casino TIENE LICENCIA. Un bono
-- solo se muestra si el país del visitante está en countries (vacía = no se
-- muestra en ninguno) y no está en blocked_countries. Sin país = ES.

ALTER TABLE bonuses ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE bonuses ADD COLUMN IF NOT EXISTS conditions text;  -- condiciones al lado de la oferta (texto corto)

-- Locowin sale de la web.
DELETE FROM bonuses WHERE lower(casino_name) = 'locowin';

-- Destacados y orden: Casino Barcelona (1), Casino Gran Madrid (2), después
-- Betfair, DAZNBet, YoCasino, Marathonbet y Betway.
UPDATE bonuses SET featured = true WHERE casino_name IN ('Casino Barcelona', 'Casino Gran Madrid');
UPDATE bonuses SET position = CASE casino_name
    WHEN 'Casino Barcelona'   THEN 1
    WHEN 'Casino Gran Madrid' THEN 2
    WHEN 'Betfair'            THEN 3
    WHEN 'DAZNBet'            THEN 4
    WHEN 'YoCasino'           THEN 5
    WHEN 'Marathonbet'        THEN 6
    WHEN 'Betway'             THEN 7
  END
WHERE casino_name IN ('Casino Barcelona', 'Casino Gran Madrid', 'Betfair', 'DAZNBet', 'YoCasino', 'Marathonbet', 'Betway');

-- ───────────────────────── pronósticos ─────────────────────────

CREATE TABLE IF NOT EXISTS predictions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',          -- texto plano; el front lo escapa al pintar
  sport text,
  league text,
  pick text,
  odds numeric(8, 2),
  event_at integer,
  published_at integer,
  is_published boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'telegram')),
  telegram_message_id bigint,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_predictions_telegram_message
  ON predictions (telegram_message_id) WHERE telegram_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_predictions_published
  ON predictions (is_published, published_at DESC);

ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  GRANT ALL ON TABLE predictions TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ───────────────────────── textos legales ─────────────────────────

CREATE TABLE IF NOT EXISTS legal_pages (
  slug text PRIMARY KEY CHECK (slug IN ('aviso-legal', 'terminos', 'privacidad', 'cookies', 'juego-responsable')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at integer NOT NULL
);

-- Textos legales de Chimuelo SL (entregados por el dueño). Editables desde el
-- panel (/legal). Si la fila ya existe con el cuerpo vacío se rellena; si ya
-- tiene texto, no se pisa.
INSERT INTO legal_pages (slug, title, body, updated_at) VALUES
  ('aviso-legal', 'Aviso legal', $legal$Titular. Mateoz Shop (mateoz.com y mateozshop.com) es la web del creador de contenido Mateoz. Su titular es Chimuelo SL, con NRT L-715202-G y domicilio en Av. Santa Coloma 55, 1-4, AD500 Andorra la Vella (Andorra). Administrador: Mateo Molino Andreu.

Contacto y reclamaciones. Puedes escribirnos a info@soymateoz.com o por correo postal al domicilio indicado. Respondemos en el plazo máximo de un mes.

Qué es Mateoz Shop. Es una web de entretenimiento con un sistema gratuito de puntos para la comunidad de Mateoz. No es un casino ni un operador de juego, y no gestiona apuestas ni dinero de los usuarios.

Publicidad y enlaces de afiliado. La sección de bonos es publicidad. Sus enlaces son de afiliado: si te registras en un casino a través de ellos, Chimuelo SL puede recibir una comisión, sin coste para ti. Los casinos que se muestran a los usuarios de España tienen licencia en España (DGOJ). Cada oferta pertenece al casino que la publica y está sujeta a las condiciones que figuran en su web. Los casinos no nos facilitan datos de tu cuenta.

Última actualización: 16 de noviembre de 2026.$legal$, extract(epoch FROM now())::integer),
  ('terminos', 'Términos y condiciones', $legal$1. Aceptación. Al crear una cuenta en Mateoz Shop aceptas estos términos.

2. Quién puede participar. Solo personas mayores de 18 años. Se permite una única cuenta por persona.

3. Puntos. Los puntos son gratuitos. Se obtienen viendo los directos de Mateoz y participando en la web. No tienen valor económico y no se pueden comprar, vender, transferir ni cambiar por dinero. Suscribirse, donar, o registrarse o depositar en un casino no da puntos. Todos los saldos se reinician el día 1 de cada mes.

4. Tienda. Los premios se consiguen mediante pujas con puntos. Cuando termina la cuenta atrás gana la puja más alta, y a quien ha sido superado se le devuelven sus puntos. Las condiciones de cada puja se muestran en la tienda.

5. Cajas, Crash y Plinko. Son juegos gratuitos de entretenimiento en los que solo se utilizan puntos. No son sorteos ni apuestas: no cuestan dinero y en ellos no se juega ni se gana dinero.

6. Premios. Los premios disponibles son los que aparecen en la web en cada momento y no se pueden cambiar por dinero. Antes de entregarlos podemos pedirte que acredites tu identidad y tu mayoría de edad. La entrega se realiza en un plazo máximo de 30 días. Si el premio lo entrega un tercero, como las tiradas de un casino, se aplican además las condiciones de ese tercero. Los impuestos que, en su caso, correspondan al ganador en su país son a su cargo.

7. Uso indebido. Está prohibido usar bots o varias cuentas y manipular de cualquier forma los puntos, las pujas o los juegos. Si ocurre, podemos retirar los puntos y los premios y cerrar la cuenta. Puedes reclamar la decisión en info@soymateoz.com.

8. Cambios en el servicio. Podemos modificar las reglas o los premios, o cerrar el servicio, avisándolo en la web. Los cambios no afectan a los premios ya ganados.

9. Responsabilidad. La web se ofrece tal cual, sin garantía de disponibilidad continua ni de ausencia de errores. No respondemos de las incidencias de Kick, Twitch, Discord u otros servicios ajenos, ni de los casinos enlazados, que se rigen por sus propias condiciones. Cada usuario es responsable de su cuenta y de la actividad que se realice desde ella.

10. Ley aplicable. Estos términos se rigen por la ley de Andorra. Si eres consumidor, conservas la protección de las normas imperativas de tu país de residencia y puedes reclamar ante los tribunales de tu domicilio.

Última actualización: 16 de noviembre de 2026.$legal$, extract(epoch FROM now())::integer),
  ('privacidad', 'Política de privacidad', $legal$Responsable. Chimuelo SL, con los datos que figuran en el aviso legal. Contacto: info@soymateoz.com.

Datos que tratamos. Cuando inicias sesión con Discord, Kick o Twitch recibimos tu identificador, tu nombre de usuario, tu avatar y, si lo autorizas, tu correo electrónico. También guardamos tu país, el tiempo que ves los directos y tu actividad en el chat, tus puntos, pujas, cajas y jugadas, tu dirección IP y datos técnicos de tu dispositivo. Si ganas un premio, tratamos además los datos necesarios para entregártelo y comprobar tu edad. Tu nombre de usuario y tus puntos pueden mostrarse en la clasificación.

Finalidades y base legal.
• Gestionar tu cuenta, tus puntos y tus premios: ejecución de los términos y condiciones.
• Prevenir el fraude y las cuentas múltiples, y mostrar la clasificación: interés legítimo.
• Cumplir nuestras obligaciones legales.
• Enviarte comunicaciones, solo si las aceptas: consentimiento.
Los datos de tu cuenta son necesarios para participar.

Destinatarios. Acceden a los datos nuestros proveedores técnicos (alojamiento web, Discord, Kick, Twitch y quienes intervienen en la entrega de premios) y las autoridades cuando la ley lo exige. Algunos proveedores están en Estados Unidos; en ese caso se aplican las garantías previstas en la normativa (cláusulas contractuales tipo o Marco de Privacidad de Datos UE-EE. UU.).

Conservación. Conservamos tus datos mientras mantengas la cuenta. Cuando la das de baja, se eliminan o anonimizan en un plazo de 30 días, salvo los relativos a premios entregados, que se conservan durante los plazos legales.

Tus derechos. Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad, y retirar tu consentimiento, escribiendo a info@soymateoz.com. Respondemos en el plazo de un mes. También puedes reclamar ante la Agència Andorrana de Protecció de Dades (apda.ad) o ante la autoridad de tu país; en España, la Agencia Española de Protección de Datos (aepd.es).

Última actualización: 16 de noviembre de 2026.$legal$, extract(epoch FROM now())::integer),
  ('cookies', 'Política de cookies', $legal$Utilizamos cookies técnicas, necesarias para iniciar sesión y recordar tus preferencias. Las cookies de analítica y el reproductor de Kick o Twitch solo se cargan si las aceptas.

Puedes aceptarlas o rechazarlas con la misma facilidad en el aviso de cookies, y cambiar tu elección en cualquier momento desde el pie de la web.

Última actualización: 16 de noviembre de 2026.$legal$, extract(epoch FROM now())::integer),
  ('juego-responsable', 'Juego responsable', $legal$Solo para mayores de 18 años. La ludopatía es un riesgo del juego.

Esta web enlaza a casinos online en los que se juega con dinero real. Si eres menor de edad, no continúes.

Si tú o alguien de tu entorno tiene un problema con el juego, puedes pedir ayuda en juegoseguro.es. También puedes autoexcluirte de todos los casinos con licencia en España a través de la DGOJ.$legal$, extract(epoch FROM now())::integer)
ON CONFLICT (slug) DO UPDATE
  SET title = EXCLUDED.title, body = EXCLUDED.body, updated_at = EXCLUDED.updated_at
  WHERE legal_pages.body = '';

ALTER TABLE legal_pages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  GRANT ALL ON TABLE legal_pages TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
