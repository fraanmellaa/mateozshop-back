export const REDEEM_PRODUCT_NO_DIRECT_REWARD = {
  subject: "¡Producto canjeado! - Mateoz Shop",
  html: `
    <p>Hola,</p>
    <p>Has canjeado un producto en Mateoz Shop. Nuestro equipo se pondrá en contacto contigo pronto para gestionar el envío o la entrega del producto.</p>
    <p>Gracias por usar Mateoz Shop.</p>
    <p>Saludos,<br/>El equipo de Mateoz Shop</p>
  `,
};

export const REDEEM_PRODUCT_WITH_DIRECT_REWARD = {
  subject: "¡Producto canjeado! - Mateoz Shop",
  html: `
    <p>Hola,</p>
    <p>Has canjeado un producto en Mateoz Shop. Aquí tienes el código para reclamar tu producto:</p>
    <p><strong>Código: {{code}}</strong></p>
    <p>Gracias por usar Mateoz Shop.</p>
    <p>Saludos,<br/>El equipo de Mateoz Shop</p>
  `,
};
