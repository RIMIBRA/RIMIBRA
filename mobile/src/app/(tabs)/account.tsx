import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { authErrorMessage, useAuth } from '@/lib/auth';

function LoggedInView() {
  const { user, logout } = useAuth();
  const theme = useTheme();
  if (!user) return null;

  return (
    <View style={styles.form}>
      <ThemedView type="backgroundElement" style={styles.profileCard}>
        <ThemedText type="subtitle">{user.email}</ThemedText>
        <View style={styles.badgeRow}>
          <ThemedView type="backgroundSelected" style={styles.badge}>
            <ThemedText type="smallBold">{user.plan === 'free' ? 'Gratuit' : user.plan.toUpperCase()}</ThemedText>
          </ThemedView>
          {user.isAdmin && (
            <ThemedView type="backgroundSelected" style={styles.badge}>
              <ThemedText type="smallBold" style={{ color: theme.primary }}>
                Admin
              </ThemedText>
            </ThemedView>
          )}
        </View>
      </ThemedView>

      <Pressable style={[styles.button, styles.dangerButton, { borderColor: theme.danger }]} onPress={logout}>
        <ThemedText type="smallBold" themeColor="danger">
          Se déconnecter
        </ThemedText>
      </Pressable>
    </View>
  );
}

function AuthForm() {
  const { login, register } = useAuth();
  const theme = useTheme();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!email || !password) {
      setError('Email et mot de passe requis');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const forgotPassword = async () => {
    if (!email) {
      setError("Entre ton email d'abord pour recevoir le lien de réinitialisation");
      return;
    }
    try {
      await api.forgotPassword(email);
      Alert.alert('Email envoyé', 'Si un compte existe avec cet email, un lien de réinitialisation vient de lui être envoyé.');
    } catch (err) {
      setError(authErrorMessage(err));
    }
  };

  return (
    <View style={styles.form}>
      <ThemedText type="title" style={styles.brandTitle}>
        🔒 footpredictongoal
      </ThemedText>

      <View style={styles.modeSwitch}>
        <Pressable
          style={[styles.modeButton, mode === 'login' && { backgroundColor: theme.primary }]}
          onPress={() => setMode('login')}>
          <ThemedText type="smallBold" style={mode === 'login' ? styles.modeTextActive : undefined}>
            Connexion
          </ThemedText>
        </Pressable>
        <Pressable
          style={[styles.modeButton, mode === 'register' && { backgroundColor: theme.primary }]}
          onPress={() => setMode('register')}>
          <ThemedText type="smallBold" style={mode === 'register' ? styles.modeTextActive : undefined}>
            Créer un compte
          </ThemedText>
        </Pressable>
      </View>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        keyboardType="email-address"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Mot de passe"
        placeholderTextColor={theme.textSecondary}
        secureTextEntry
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />

      {error && (
        <ThemedText themeColor="danger" type="small">
          {error}
        </ThemedText>
      )}

      <Pressable
        style={[styles.button, { backgroundColor: theme.primary }]}
        onPress={submit}
        disabled={submitting}>
        {submitting ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <ThemedText type="smallBold" style={styles.buttonText}>
            {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
          </ThemedText>
        )}
      </Pressable>

      {mode === 'login' && (
        <Pressable onPress={forgotPassword}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centeredText}>
            Mot de passe oublié ?
          </ThemedText>
        </Pressable>
      )}
    </View>
  );
}

export default function AccountScreen() {
  const { user, loading } = useAuth();
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.content}>
          {loading ? (
            <ActivityIndicator color={theme.primary} />
          ) : user ? (
            <LoggedInView />
          ) : (
            <AuthForm />
          )}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  form: { gap: Spacing.three },
  brandTitle: { fontSize: 24, lineHeight: 30, textAlign: 'center', marginBottom: Spacing.two },
  modeSwitch: { flexDirection: 'row', gap: Spacing.two },
  modeButton: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  modeTextActive: { color: '#ffffff' },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonText: { color: '#ffffff' },
  dangerButton: { borderWidth: 1 },
  centeredText: { textAlign: 'center' },
  profileCard: { borderRadius: Spacing.three, padding: Spacing.four, gap: Spacing.two },
  badgeRow: { flexDirection: 'row', gap: Spacing.two },
  badge: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.five },
});
