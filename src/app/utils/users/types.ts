export type User = {
  id: number;
  username: string;
  kick_id: string;
  image: string;
  email: string;
  total_points: number;
  used_points: number;
  actual_points: number; // Calculated as total_points - used_points
  created_at: string; // ISO date string
};
