import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { Sport } from '@/lib/api';

export interface SportConfig {
  key: Sport;
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
}

// Réservés au plan premium/vip côté serveur (voir requireSportAccess dans server.js) —
// contrairement au foot, accessible gratuitement.
export const SPORTS: SportConfig[] = [
  { key: 'nfl', label: 'NFL', icon: 'american-football-outline' },
  { key: 'nba', label: 'Basketball', icon: 'basketball-outline' },
  { key: 'hockey', label: 'Hockey', icon: 'snow-outline' },
  { key: 'baseball', label: 'Baseball', icon: 'baseball-outline' },
  { key: 'handball', label: 'Handball', icon: 'hand-left-outline' },
  { key: 'tennis', label: 'Tennis', icon: 'tennisball-outline' },
];

export function sportLabel(sport: Sport): string {
  return SPORTS.find((s) => s.key === sport)?.label ?? sport;
}
