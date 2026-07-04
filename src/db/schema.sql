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

-- Historique des pronostics vs résultats réels : sert à mesurer (par source, par niveau de
-- confiance) si les poids de l'algo (form/classement/h2h/blessures) et le blend avec les
-- sites externes sont réellement fiables, plutôt que de les ajuster à l'aveugle.
-- Une ligne par match "upcoming" analysé ; complétée (actual_*, correct, resolved_at) une
-- fois le match terminé, sans avoir besoin de tout ré-analyser.
CREATE TABLE IF NOT EXISTS prediction_results (
  id                SERIAL PRIMARY KEY,
  sport             TEXT NOT NULL DEFAULT 'football',
  fixture_id        TEXT NOT NULL,
  league            TEXT,
  home_team         TEXT,
  away_team         TEXT,
  predicted_pick    TEXT NOT NULL,
  confidence        TEXT,
  probabilities     JSONB,
  -- Pronostic de l'algo SEUL, avant mélange avec les sources externes (blendProbabilities) —
  -- sert à mesurer si le blend améliore vraiment les choses par rapport à l'algo nu, et à
  -- calibrer son poids d'ancrage (voir algorithm/calibration.js) sur des données réelles.
  algo_pick         TEXT,
  algo_probabilities JSONB,
  algo_correct      BOOLEAN,
  goal_prediction   JSONB,
  sources           JSONB NOT NULL DEFAULT '{}',
  no_api_data       BOOLEAN NOT NULL DEFAULT false,
  -- false = suivi uniquement en tâche de fond (trackExtraFixturesForData), jamais montré à un
  -- visiteur (au-delà des MAX_FIXTURES_PER_DAY affichés) -> sert à distinguer les deux dans le dashboard
  featured          BOOLEAN NOT NULL DEFAULT true,
  predicted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actual_home_score INTEGER,
  actual_away_score INTEGER,
  correct           BOOLEAN,
  btts_correct      BOOLEAN,
  over25_correct    BOOLEAN,
  resolved_at       TIMESTAMPTZ,
  UNIQUE (sport, fixture_id)
);

-- Idempotent : ajoute la colonne si la table existait déjà avant cette mise à jour
ALTER TABLE prediction_results ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE prediction_results ADD COLUMN IF NOT EXISTS algo_pick TEXT;
ALTER TABLE prediction_results ADD COLUMN IF NOT EXISTS algo_probabilities JSONB;
ALTER TABLE prediction_results ADD COLUMN IF NOT EXISTS algo_correct BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_prediction_results_unresolved
  ON prediction_results(sport) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_prediction_results_predicted_at
  ON prediction_results(sport, predicted_at);

-- Déblocage du détail complet (breakdown : forme, H2H, blessures, cotes — normalement réservé
-- au plan VIP, voir tiers.js) contre le visionnage d'une pub récompensée, match par match,
-- pour un utilisateur gratuit/premium. Persistant : un match déjà débloqué le reste (pas de
-- nouvelle pub à chaque fois qu'on rouvre le même match).
CREATE TABLE IF NOT EXISTS ad_unlocks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport       TEXT NOT NULL,
  fixture_id  TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sport, fixture_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_unlocks_lookup ON ad_unlocks(user_id, sport, fixture_id);
