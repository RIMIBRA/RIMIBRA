import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { MatchDetailContent } from '@/components/match-detail';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type PredictionEntry, type Sport } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function SportMatchDetailScreen() {
  const { sport, id } = useLocalSearchParams<{ sport: Sport; id: string }>();
  const { token } = useAuth();
  const theme = useTheme();

  const [entry, setEntry] = useState<PredictionEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.sportMatch(sport, token, id);
        if (!cancelled) setEntry(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Impossible de charger ce match.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, id, token]);

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

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: `${entry.fixture.home} - ${entry.fixture.away}` }} />
      <ScrollView contentContainerStyle={styles.content}>
        <MatchDetailContent entry={entry} />
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
});
