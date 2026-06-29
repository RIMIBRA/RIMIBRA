-- Schéma RIMIBRA : utilisateurs, abonnements, cache API, journal de requêtes

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent : ajoute la colonne si la table existait déjà avant cette mise à jour
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Un seul abonnement actif par utilisateur à la fois (le plus récent fait foi)
CREATE TABLE IF NOT EXISTS subscriptions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan        TEXT NOT NULL CHECK (plan IN ('free', 'premium', 'vip')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, started_at DESC);

-- Note : le cache des réponses API (cache-data.json) et le journal de quotas
-- (cache-requests*.json) restent en fichiers pour l'instant — migration vers Postgres
-- à faire séparément si besoin, ça touche ~13 fichiers de scrapers.

-- Un combiné reste figé tant qu'il n'est pas résolu (tous ses matchs terminés) — pas
-- jusqu'à minuit. Une fois gagné/perdu, un nouveau peut être généré le même jour avec
-- d'autres matchs (pas de UNIQUE sur date+sport : plusieurs combinés successifs possibles).
CREATE TABLE IF NOT EXISTS combos (
  id                   SERIAL PRIMARY KEY,
  combo_date           DATE NOT NULL,
  sport                TEXT NOT NULL,
  sport_label          TEXT NOT NULL,
  matches              JSONB NOT NULL,
  combined_probability INTEGER NOT NULL,
  risk                 TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (combo_date, sport)
);

-- Retire l'ancienne contrainte d'unicité (un seul combiné/jour/sport) — désormais
-- plusieurs combinés successifs sont autorisés le même jour pour un même sport
ALTER TABLE combos DROP CONSTRAINT IF EXISTS combos_combo_date_sport_key;

CREATE INDEX IF NOT EXISTS idx_combos_date_sport ON combos(combo_date, sport, created_at);
