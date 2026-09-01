// Client HTTP vers l'API backend existante (Express, voir src/routes/*.js à la racine du
// repo) — inchangée pour l'app mobile, on ne fait que la consommer.
export const API_BASE_URL = 'https://footpredictongoal.com/api';

export type Plan = 'free' | 'premium' | 'vip' | string;

export interface AuthUser {
  id: number;
  email: string;
  plan: Plan;
  isAdmin: boolean;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface FixtureInfo {
  id: number;
  date: string;
  league: string;
  leagueId?: number;
  home: string;
  away: string;
  homeLogo?: string;
  awayLogo?: string;
}

export interface Recommendation {
  pick: string;
  confidence: 'Faible' | 'Moyenne' | 'Élevée';
}

export interface Probabilities {
  home: number;
  draw?: number;
  away: number;
}

export interface GoalPrediction {
  btts: number;
  over25: number;
}

export interface PredictionEntry {
  fixture: FixtureInfo;
  matchState: 'upcoming' | 'live' | 'finished';
  finished?: boolean;
  finalScore?: { home: number; away: number };
  scores?: { home: number; away: number };
  probabilities?: Probabilities;
  recommendation?: Recommendation;
  insufficientData?: boolean;
  error?: string;
  goalPrediction?: GoalPrediction;
  goalPredictionLocked?: boolean;
  breakdownLocked?: boolean;
}

export interface TodayResponse {
  date: string;
  predictions: PredictionEntry[];
  total: number;
  analyzed: number;
  requestsUsed: number;
  requestsLeft: number;
  limitReached: boolean;
  freePreview?: boolean;
}

export class ApiError extends Error {
  status: number;
  upgradeRequired: boolean;
  constructor(message: string, status: number, upgradeRequired = false) {
    super(message);
    this.status = status;
    this.upgradeRequired = upgradeRequired;
  }
}

// Sports partageant tous le même compte api-sports.io côté serveur (voir src/api/*.js à la
// racine du repo) — réservés au plan premium/vip (requireSportAccess), contrairement au foot.
export type Sport = 'nfl' | 'nba' | 'hockey' | 'baseball' | 'handball' | 'tennis';

async function request<T>(path: string, options: RequestInit & { token?: string | null } = {}): Promise<T> {
  const { token, headers, ...rest } = options;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new ApiError(body?.error || `Erreur réseau (${response.status})`, response.status, !!body?.upgradeRequired);
  }

  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  register: (email: string, password: string) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) }),

  me: (token: string) => request<AuthUser>('/auth/me', { token }),

  forgotPassword: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),

  footballToday: (token: string | null, date?: string) =>
    request<TodayResponse>(`/predictions/today${date ? `?date=${date}` : ''}`, { token }),

  footballFixture: (token: string | null, id: number | string) =>
    request<PredictionEntry & { sport: string }>(`/predictions/fixture/${id}`, { token }),

  // NFL/NBA/Hockey/Baseball/Handball/Tennis suivent tous la même convention de routes côté
  // serveur (/api/<sport>/predictions/today et /game/:id), contrairement au foot (/fixture/:id).
  sportToday: (sport: Sport, token: string | null, date?: string) =>
    request<TodayResponse>(`/${sport}/predictions/today${date ? `?date=${date}` : ''}`, { token }),

  sportMatch: (sport: Sport, token: string | null, id: number | string) =>
    request<PredictionEntry & { sport: string }>(`/${sport}/predictions/game/${id}`, { token }),
};
