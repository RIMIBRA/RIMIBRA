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

-- Mis à jour à chaque connexion/inscription (voir db/users.js touchLastLogin) : sert à
-- distinguer au dashboard admin les comptes créés mais jamais revenus des utilisateurs
-- réellement actifs, ce que la seule date de création ne permet pas de voir.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

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

-- Catalogue des offres payantes (durée + prix par plan) — séparé de `subscriptions` (qui reste
-- "quel plan a CE user, jusqu'à quand") pour pouvoir facturer/afficher plusieurs durées par plan
-- (ex: Premium 1 ou 2 semaines) sans dupliquer la logique d'accès (tiers.js ne connaît que
-- 'free'/'premium'/'vip', jamais la durée choisie).
CREATE TABLE IF NOT EXISTS subscription_plans (
  id            SERIAL PRIMARY KEY,
  plan          TEXT NOT NULL CHECK (plan IN ('premium', 'vip')),
  duration_days INTEGER NOT NULL,
  price_fcfa    INTEGER NOT NULL,
  label         TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (plan, duration_days)
);

INSERT INTO subscription_plans (plan, duration_days, price_fcfa, label) VALUES
  ('premium', 7, 500, 'Premium — 1 semaine'),
  ('premium', 14, 1000, 'Premium — 2 semaines'),
  ('vip', 14, 2500, 'VIP — 2 semaines'),
  ('vip', 30, 5000, 'VIP — 30 jours')
ON CONFLICT (plan, duration_days) DO NOTHING;

-- Quelle offre précise a été achetée (utile pour les reçus/factures une fois le paiement réel
-- branché) — nul pour un abonnement 'free' ou un changement de plan manuel sans offre associée.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES subscription_plans(id);

-- Une ligne par tentative de paiement (GeniusPay pour l'instant). Le plan n'est activé
-- (setPlan) que lorsque le webhook confirme 'completed' — jamais depuis la redirection
-- success_url seule, qu'un utilisateur pourrait atteindre sans avoir vraiment payé.
CREATE TABLE IF NOT EXISTS payment_transactions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id      INTEGER NOT NULL REFERENCES subscription_plans(id),
  provider     TEXT NOT NULL DEFAULT 'geniuspay',
  reference    TEXT UNIQUE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'expired')),
  amount_fcfa  INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_reference ON payment_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user ON payment_transactions(user_id, created_at DESC);

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

-- DÉPRÉCIÉE : servait au déblocage match par match contre le visionnage de pubs récompensées.
-- Retirée de l'application (aucun compte Google Ad Manager branché => aucune vérification
-- serveur réelle du visionnage, un utilisateur pouvait appeler l'ancien /api/ads/unlock
-- directement et débloquer le contenu premium/VIP sans jamais voir de pub). Le déblocage se
-- fait désormais uniquement par abonnement (voir auth/breakdownGate.js et auth/tiers.js).
-- Table conservée telle quelle (pas de DROP) pour ne pas perdre l'historique existant ; plus
-- aucun code applicatif ne la lit ni ne l'écrit.
CREATE TABLE IF NOT EXISTS ad_unlocks (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport       TEXT NOT NULL,
  fixture_id  TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'vip_details' CHECK (level IN ('premium_details', 'vip_details')),
  views_count INTEGER NOT NULL DEFAULT 0,
  unlocked_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent : migre une table existante créée sous l'ancien schéma (un seul niveau,
-- débloqué dès la première pub vue) sans perdre les lignes déjà là.
ALTER TABLE ad_unlocks ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'vip_details';
ALTER TABLE ad_unlocks ADD COLUMN IF NOT EXISTS views_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ad_unlocks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ad_unlocks ALTER COLUMN unlocked_at DROP NOT NULL;
ALTER TABLE ad_unlocks DROP CONSTRAINT IF EXISTS ad_unlocks_user_id_sport_fixture_id_key;

-- Un index unique (pas une contrainte nommée) pour pouvoir le recréer sans erreur à chaque
-- migration (CREATE CONSTRAINT n'a pas d'équivalent IF NOT EXISTS fiable) ; sert aussi de
-- cible à ON CONFLICT côté application.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_unlocks_user_sport_fixture_level
  ON ad_unlocks(user_id, sport, fixture_id, level);

-- Analytics de trafic minimal, sans cookie ni service tiers (voir db/analytics.js) : une ligne
-- par vue de page. visitor_hash = hash(IP + user-agent + jour + secret serveur), jamais l'IP en
-- clair -> sert uniquement à approximer les visiteurs uniques par jour (compte de hashs
-- distincts), impossible à faire remonter à une personne précise.
CREATE TABLE IF NOT EXISTS page_views (
  id            SERIAL PRIMARY KEY,
  path          TEXT NOT NULL,
  visitor_hash  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views(created_at);

-- Clics sur les liens d'affiliation (voir public/partenaires.html) — même hash de visiteur que
-- page_views, pour savoir quel partenaire convertit le mieux sans jamais stocker l'IP en clair.
CREATE TABLE IF NOT EXISTS partner_clicks (
  id            SERIAL PRIMARY KEY,
  partner       TEXT NOT NULL,
  path          TEXT NOT NULL,
  visitor_hash  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_clicks_created_at ON partner_clicks(created_at);
