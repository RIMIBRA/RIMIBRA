import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type PredictionEntry } from '@/lib/api';
import { formatDay, formatKickoff } from '@/lib/format';
import { useAuth } from '@/lib/auth';

function ProbabilityBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.probRow}>
      <ThemedText type="small" style={styles.probLabel}>
        {label}
      </ThemedText>
      <View style={styles.probTrack}>
        <View style={[styles.probFill, { width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }]} />
      </View>
      <ThemedText type="smallBold" style={styles.probValue}>
        {Math.round(value)}%
      </ThemedText>
    </View>
  );
}

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const theme = useTheme();

  const [entry, setEntry] = useState<PredictionEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.footballFixture(token, id);
        if (!cancelled) setEntry(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Impossible de charger ce match.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  if (error) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="danger">{error}</ThemedText>
      </ThemedView>
    );
  }

  if (!entry) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.primary} />
      </ThemedView>
    );
  }

  const { fixture } = entry;
  const isFinished = entry.matchState === 'finished';

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: `${fixture.home} - ${fixture.away}` }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          {fixture.league}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDay(fixture.date)} · {isFinished ? 'Terminé' : formatKickoff(fixture.date)}
        </ThemedText>

        <View style={styles.matchup}>
          <ThemedText type="subtitle" style={styles.team}>
            {fixture.home}
          </ThemedText>
          {isFinished && entry.finalScore ? (
            <ThemedText type="title" style={styles.score}>
              {entry.finalScore.home} — {entry.finalScore.away}
            </ThemedText>
          ) : (
            <ThemedText type="subtitle" themeColor="textSecondary">
              vs
            </ThemedText>
          )}
          <ThemedText type="subtitle" style={styles.team}>
            {fixture.away}
          </ThemedText>
        </View>

        {entry.insufficientData && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText themeColor="textSecondary">
              Pas assez de données pour analyser ce match pour l&apos;instant.
            </ThemedText>
          </ThemedView>
        )}

        {entry.recommendation && !entry.insufficientData && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              PRONOSTIC
            </ThemedText>
            <ThemedText type="subtitle" style={{ color: theme.primary }}>
              {entry.recommendation.pick}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Confiance : {entry.recommendation.confidence}
            </ThemedText>
          </ThemedView>
        )}

        {entry.probabilities && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
              PROBABILITÉS
            </ThemedText>
            <ProbabilityBar label={fixture.home} value={entry.probabilities.home} color={theme.primary} />
            {entry.probabilities.draw != null && (
              <ProbabilityBar label="Nul" value={entry.probabilities.draw} color={theme.textSecondary} />
            )}
            <ProbabilityBar label={fixture.away} value={entry.probabilities.away} color={theme.danger} />
          </ThemedView>
        )}

        {entry.goalPrediction && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardTitle}>
              BUTS
            </ThemedText>
            <ThemedText type="default">
              BTTS (les deux marquent) : {Math.round(entry.goalPrediction.btts)}%
            </ThemedText>
            <ThemedText type="default">Plus de 2,5 buts : {Math.round(entry.goalPrediction.over25)}%</ThemedText>
          </ThemedView>
        )}

        {entry.goalPredictionLocked && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText themeColor="textSecondary">
              🔒 Prédiction de buts réservée aux abonnés Premium et VIP
            </ThemedText>
          </ThemedView>
        )}

        {entry.breakdownLocked && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText themeColor="textSecondary">
              🔒 Analyse détaillée (forme, confrontations, cotes) réservée aux abonnés VIP
            </ThemedText>
          </ThemedView>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  matchup: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.four,
  },
  team: { flex: 1 },
  score: { fontSize: 32, lineHeight: 38 },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one, marginTop: Spacing.two },
  cardTitle: { marginBottom: Spacing.one },
  probRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  probLabel: { width: 90 },
  probTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(128,128,128,0.25)', overflow: 'hidden' },
  probFill: { height: '100%', borderRadius: 4 },
  probValue: { width: 44, textAlign: 'right' },
});
