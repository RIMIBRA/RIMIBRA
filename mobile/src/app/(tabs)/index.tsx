import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PredictionCard } from '@/components/prediction-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, ApiError, type PredictionEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function FootballTodayScreen() {
  const { token } = useAuth();
  const router = useRouter();
  const theme = useTheme();

  const [predictions, setPredictions] = useState<PredictionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      isRefresh ? setRefreshing(true) : setError(null);
      try {
        const res = await api.footballToday(token);
        setPredictions(res.predictions);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Impossible de charger les pronostics du jour.');
      } finally {
        setRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    load();
  }, [load]);

  if (predictions === null && !error) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator color={theme.primary} />
      </ThemedView>
    );
  }

  if (error && predictions === null) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText themeColor="danger" style={styles.errorText}>
          {error}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList
          data={predictions ?? []}
          keyExtractor={(item) => String(item.fixture.id)}
          contentContainerStyle={styles.listContent}
          style={{ maxWidth: MaxContentWidth, alignSelf: 'center', width: '100%' }}
          ListHeaderComponent={
            <ThemedText type="title" style={styles.title}>
              Aujourd&apos;hui
            </ThemedText>
          }
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.emptyText}>
              Aucun match trouvé pour cette date.
            </ThemedText>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.primary} />}
          renderItem={({ item }) => (
            <PredictionCard entry={item} onPress={() => router.push(`/match/${item.fixture.id}`)} />
          )}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.two }} />}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  errorText: { textAlign: 'center' },
  listContent: { padding: Spacing.three, gap: Spacing.two },
  title: { fontSize: 28, lineHeight: 34, marginBottom: Spacing.two },
  emptyText: { textAlign: 'center', marginTop: Spacing.five },
});
