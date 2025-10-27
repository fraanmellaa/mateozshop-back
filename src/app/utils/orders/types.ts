export type DecoratedOrder = {
  id: number;
  username: string;
  product_name: string;
  product_image: string;
  status: number;
  total: number;
  created_at: string;
};

export type UserOrder = {
  id: number;
  product_name: string;
  product_image: string;
  cost: number;
  status: number;
  created_at: string;
};

export type OrderDetail = {
  id: number;
  status: number;
  total: number;
  created_at: string;
  user: {
    id: number;
    username: string;
    email: string;
    discord_id: string;
    kick_id: string | null;
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
  };
};
