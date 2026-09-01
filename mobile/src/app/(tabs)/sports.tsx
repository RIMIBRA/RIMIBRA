import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SPORTS } from '@/lib/sports';

export default function SportsMenuScreen() {
  const router = useRouter();
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList
          data={SPORTS}
          keyExtractor={(item) => item.key}
          style={{ maxWidth: MaxContentWidth, alignSelf: 'center', width: '100%' }}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <>
              <ThemedText type="title" style={styles.title}>
                Sports
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.subtitle}>
                Réservés aux abonnés Premium et VIP
              </ThemedText>
            </>
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/sport/${item.key}`)}>
              <ThemedView type="backgroundElement" style={styles.row}>
                <Ionicons name={item.icon} size={24} color={theme.primary} />
                <ThemedText type="default" style={styles.rowLabel}>
                  {item.label}
                </ThemedText>
                <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
              </ThemedView>
            </Pressable>
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
  listContent: { padding: Spacing.three, gap: Spacing.two },
  title: { fontSize: 28, lineHeight: 34 },
  subtitle: { marginBottom: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  rowLabel: { flex: 1 },
});
