export type User = {
  id: number;
  username: string;
  discord_id: string;
  kick_id: string | null;
  kick_username: string | null;
  kick_linked_at: number | null; // segundos Unix; Kick no expone la fecha de creación de la cuenta
  twitch_id: string | null;
  twitch_username: string | null;
  twitch_created_at: number | null; // creación de la cuenta de Twitch (Helix)
  twitch_linked_at: number | null;
  adult_confirmed_at: number | null;
  terms_accepted_at: number | null;
  steam_trade_url: string | null;
  image: string;
  email: string;
  total_points: number;
  used_points: number;
  verification_code: number;
  is_banned?: boolean | null;
  actual_points: number; // Calculated as total_points - used_points
  created_at: string; // ISO date string
};
