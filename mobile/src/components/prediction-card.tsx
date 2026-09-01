import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatKickoff } from '@/lib/format';
import type { FixtureInfo, PredictionEntry } from '@/lib/api';

function pickLabel(pick: string, fixture: FixtureInfo): string {
  if (pick.startsWith('1')) return fixture.home;
  if (pick.startsWith('2')) return fixture.away;
  if (pick.startsWith('X')) return 'Match nul';
  return pick;
}

const confidenceColor = (theme: ReturnType<typeof useTheme>, confidence?: string) => {
  if (confidence === 'Élevée') return theme.success;
  if (confidence === 'Moyenne') return theme.primary;
  return theme.textSecondary;
};

export function PredictionCard({ entry, onPress }: { entry: PredictionEntry; onPress: () => void }) {
  const theme = useTheme();
  const { fixture } = entry;
  const isFinished = entry.matchState === 'finished';
  const isLive = entry.matchState === 'live';

  return (
    <Pressable onPress={onPress}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.header}>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.league}>
            {fixture.league}
          </ThemedText>
          {isLive ? (
            <ThemedText type="smallBold" themeColor="danger">
              EN DIRECT
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {isFinished ? 'Terminé' : formatKickoff(fixture.date)}
            </ThemedText>
          )}
        </View>

        <View style={styles.teams}>
          <ThemedText type="default" numberOfLines={1} style={styles.teamName}>
            {fixture.home}
          </ThemedText>
          {isFinished && entry.finalScore ? (
            <ThemedText type="smallBold">
              {entry.finalScore.home} — {entry.finalScore.away}
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              vs
            </ThemedText>
          )}
          <ThemedText type="default" numberOfLines={1} style={styles.teamName}>
            {fixture.away}
          </ThemedText>
        </View>

        {!isFinished && entry.recommendation && !entry.insufficientData && (
          <View style={styles.recommendationRow}>
            <ThemedText type="small" themeColor="textSecondary">
              Pronostic :
            </ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              {pickLabel(entry.recommendation.pick, fixture)}
            </ThemedText>
            <View
              style={[styles.confidenceDot, { backgroundColor: confidenceColor(theme, entry.recommendation.confidence) }]}
            />
            <ThemedText type="small" themeColor="textSecondary">
              {entry.recommendation.confidence}
            </ThemedText>
          </View>
        )}

        {!isFinished && entry.insufficientData && (
          <ThemedText type="small" themeColor="textSecondary">
            Analyse non disponible pour ce match
          </ThemedText>
        )}
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  league: {
    flex: 1,
  },
  teams: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  teamName: {
    flex: 1,
  },
  recommendationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  confidenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: Spacing.one,
  },
});
