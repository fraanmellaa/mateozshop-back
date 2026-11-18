export type DeliveryType = "code" | "trade" | "dm";

export type DecoratedOrder = {
  id: number;
  username: string;
  product_name: string;
  product_image: string;
  status: number;
  total: number;
  created_at: string;
  delivery_type: DeliveryType;
  /** Pedido de más de `reviewThresholdEur`: hay que aprobarlo antes de entregarlo. */
  needs_review: boolean;
  reviewed: boolean;
  /** Enlace de intercambio del ganador (entrega de skins). */
  steam_trade_url: string | null;
  /** Lleva un código reservado. */
  has_code: boolean;
  code_email_sent: boolean | null;
  /** Premio pujado con puntos VIP: queda pendiente de comprobar la verificación. */
  vip: boolean;
};

export type UserOrder = {
  id: number;
  product_name: string;
  product_image: string;
  cost: number;
  status: number;
  created_at: string;
  delivery_type: DeliveryType;
  /** Está esperando la revisión manual (no se entrega hasta aprobarse). */
  pending_review: boolean;
};

export type OrderDetail = {
  id: number;
  status: number;
  total: number;
  created_at: string;
  /** Código entregado (o reservado, si el pedido espera revisión). */
  delivered_code: string | null;
  /** Resultado del último envío del código por email (null: sin enviar). */
  code_email_sent: boolean | null;
  needs_review: boolean;
  /** Premio pujado con puntos VIP. */
  vip: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  user: {
    id: number;
    username: string;
    email: string;
    discord_id: string;
    kick_id: string | null;
    twitch_id: string | null;
    steam_trade_url: string | null;
    image: string;
    total_points: number;
    used_points: number;
    available_points: number;
  };
  product: {
    id: number;
    name: string;
    description: string;
    image: string;
    price: number;
    stock: number;
    sendable: boolean;
    delivery_type: DeliveryType;
    value_eur: number | null;
  };
};
