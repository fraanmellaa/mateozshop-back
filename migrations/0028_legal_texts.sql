-- 0028: textos legales de Chimuelo SL, versión definitiva entregada por el dueño.
--
-- A diferencia de 0025 (que solo rellena los vacíos), esta migración SUSTITUYE
-- el texto de las cinco páginas: si se editó alguno desde el panel (/legal),
-- se pierde ese cambio. Aplicar a mano en Supabase, después de 0025.
-- La fecha de "Última actualización" es la de publicación: cámbiala aquí o en
-- el panel si se publica otro día.

SET search_path TO public;

-- La tabla pudo crearse con una versión anterior de 0025 que admitía menos
-- páginas: se renueva la regla de los slugs para aceptar las cinco actuales.
-- NOT VALID: no revisa las filas que ya hubiera, solo las nuevas.
ALTER TABLE legal_pages DROP CONSTRAINT IF EXISTS legal_pages_slug_check;
ALTER TABLE legal_pages ADD CONSTRAINT legal_pages_slug_check
  CHECK (slug IN ('aviso-legal', 'terminos', 'privacidad', 'cookies', 'juego-responsable')) NOT VALID;

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
  SET title = EXCLUDED.title,
      body = EXCLUDED.body,
      updated_at = EXCLUDED.updated_at;
