import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { PredictionCard } from '@/components/prediction-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type PredictionEntry, type Sport } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { sportLabel } from '@/lib/sports';

export default function SportTodayScreen() {
  const { sport } = useLocalSearchParams<{ sport: Sport }>();
  const { token } = useAuth();
  const router = useRouter();
  const theme = useTheme();

  const [predictions, setPredictions] = useState<PredictionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setError(null);
      setUpgradeRequired(false);
      try {
        const res = await api.sportToday(sport, token);
        setPredictions(res.predictions);
      } catch (err) {
        if (err instanceof ApiError && err.upgradeRequired) {
          setUpgradeRequired(true);
        } else {
          setError(err instanceof ApiError ? err.message : `Impossible de charger les pronostics ${sportLabel(sport)}.`);
        }
      } finally {
        setRefreshing(false);
      }
    },
    [sport, token]
  );

  useEffect(() => {
    load();
  }, [load]);

  const title = sportLabel(sport);

  if (upgradeRequired) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title }} />
        <ThemedText style={styles.lockIcon}>🔒</ThemedText>
        <ThemedText type="subtitle" style={styles.centeredText}>
          {title} réservé aux abonnés
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centeredText}>
          Ce sport nécessite un abonnement Premium ou VIP. Passe par le site footpredictongoal.com pour t&apos;abonner.
        </ThemedText>
      </ThemedView>
    );
  }

  if (predictions === null && !error) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title }} />
        <ActivityIndicator color={theme.primary} />
      </ThemedView>
    );
  }

  if (error && predictions === null) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title }} />
        <ThemedText themeColor="danger" style={styles.centeredText}>
          {error}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title }} />
      <FlatList
        data={predictions ?? []}
        keyExtractor={(item) => String(item.fixture.id)}
        contentContainerStyle={styles.listContent}
        style={{ maxWidth: MaxContentWidth, alignSelf: 'center', width: '100%' }}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.centeredText}>
            Aucun match trouvé pour cette date.
          </ThemedText>
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.primary} />}
        renderItem={({ item }) => (
          <PredictionCard entry={item} onPress={() => router.push(`/sport/${sport}/match/${item.fixture.id}`)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four, gap: Spacing.two },
  centeredText: { textAlign: 'center' },
  lockIcon: { fontSize: 40 },
  listContent: { padding: Spacing.three, gap: Spacing.two },
});
