export interface GiveawayEntry {
  userId: number;
  tickets: number;
  name: string;
  profileImage: string;
  kickId?: string;
}

export interface GiveawayWinner {
  id: number;
  name: string;
  profileImage: string;
  kickId?: string;
}

export interface Giveaway {
  id: number;
  cost: number;
  title: string;
  image: string;
  start_at: number;
  end_at: number;
  winner?: number;
  entries: GiveawayEntry[];
  winners: GiveawayWinner[];
}

export interface UserGiveaway {
  id: number;
  title: string;
  image: string;
  cost: number;
  status: "upcoming" | "active" | "finished" | "pending";
  tickets: number;
  isWinner: boolean;
  start_at: number;
  end_at: number;
  created_at: string;
}

export interface LotteryResult {
  success: boolean;
  giveawayId: number;
  winner?: {
    id: number;
    username: string;
    image: string;
    kickId?: string;
  };
  totalParticipants?: number;
  error?: string;
}

export interface GiveawayStats {
  total: number;
  active: number;
  finished: number;
  pending: number;
  upcoming: number;
  details: {
    active: Array<{ id: number; title: string; end_at: number }>;
    pending: Array<{ id: number; title: string; end_at: number }>;
  };
}

export interface CronJobResult {
  success: boolean;
  message: string;
  timestamp: string;
  results: LotteryResult[];
  summary: {
    total: number;
    successful: number;
    errors: number;
  };
}
