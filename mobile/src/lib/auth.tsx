import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, type AuthUser } from '@/lib/api';
import { clearToken, getToken, setToken } from '@/lib/storage';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Au lancement : reprend la session depuis le stockage sécurisé et revalide le profil
  // (plan/isAdmin peuvent avoir changé côté serveur depuis la dernière ouverture).
  useEffect(() => {
    (async () => {
      const stored = await getToken();
      if (!stored) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me(stored);
        setTokenState(stored);
        setUser(me);
      } catch {
        await clearToken(); // token expiré/invalide -> repartir sur un état déconnecté propre
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const applyAuth = useCallback(async (t: string, u: AuthUser) => {
    await setToken(t);
    setTokenState(t);
    setUser(u);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      await applyAuth(res.token, res.user);
    },
    [applyAuth]
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const res = await api.register(email, password);
      await applyAuth(res.token, res.user);
    },
    [applyAuth]
  );

  const logout = useCallback(async () => {
    await clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout }),
    [user, token, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Une erreur est survenue, réessaie dans quelques instants.';
}
