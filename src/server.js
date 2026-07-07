require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { attachUser, requireSportAccess, requireAdmin } = require('./auth/middleware');
const { trackExtraFixturesForData, resolveRecentResults } = require('./algorithm/predictor');
const { migrate } = require('./db/migrate');

// Filet de sécurité : loggue au lieu de laisser Node tuer tout le process. Sans process
// manager (pas de PM2/Docker ici) un crash veut dire arrêt total jusqu'à relance manuelle —
// sur plusieurs semaines de collecte continue de pronostics, une seule promesse oubliée
// quelque part suffirait sinon à couper l'app en pleine nuit.
process.on('unhandledRejection', (err) => {
  console.error('Rejet de promesse non géré (ignoré) :', err?.message || err);
});

const app = express();
const PORT = process.env.PORT || 3001;

// Nécessaire dès qu'on est derrière un proxy inverse (Render, Heroku...) : sans ça,
// express-rate-limit refuse de démarrer (il ne peut pas faire confiance à l'en-tête
// X-Forwarded-For pour identifier l'IP réelle du visiteur) et toutes les routes protégées par
// un rate limiter (login/register/ads) plantent avec une ValidationError. "1" = on fait
// confiance à exactement un saut de proxy, ce qui correspond à l'infra de Render.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false })); // CSP désactivée pour l'instant (scripts inline absents mais à revoir si on en ajoute)
// req.rawBody : Buffer exact du corps reçu, nécessaire pour vérifier la signature HMAC des
// webhooks GeniusPay (voir routes/payments.js) — un objet JSON re-sérialisé pourrait différer
// octet à octet de ce que GeniusPay a réellement signé (ordre des clés, espacement...).
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf; } })); // limite la taille du corps des requêtes (anti-DoS basique)
app.use(express.static(path.join(__dirname, '../public')));
app.use(attachUser); // remplit req.user (null si pas de token / token invalide -> traité comme 'free')

// Anti brute-force sur les routes sensibles (login/register) : 10 tentatives / 15 min / IP
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Tant qu'il n'y a pas de vérification serveur réelle du visionnage (voir routes/ads.js),
// ce taux limite au moins l'abus grossier (appels directs en boucle sans passer par une pub)
const adsLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/ads', adsLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/payments', require('./routes/payments'));

// Foot reste accessible en plan gratuit ; les autres sports nécessitent premium ou plus
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/nfl/predictions', requireSportAccess('nfl'), require('./routes/nflPredictions'));
app.use('/api/nba/predictions', requireSportAccess('nba'), require('./routes/nbaPredictions'));
app.use('/api/hockey/predictions', requireSportAccess('hockey'), require('./routes/hockeyPredictions'));
app.use('/api/baseball/predictions', requireSportAccess('baseball'), require('./routes/baseballPredictions'));
app.use('/api/handball/predictions', requireSportAccess('handball'), require('./routes/handballPredictions'));
app.use('/api/tennis/predictions', requireSportAccess('tennis'), require('./routes/tennisPredictions'));
app.use('/api/combos', require('./routes/combos'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Football Predictor démarré sur http://localhost:${PORT}`);
});

// Lancée APRÈS l'ouverture du port, jamais avant : le schéma est idempotent (CREATE TABLE IF
// NOT EXISTS...) donc quelques requêtes peuvent en théorie arriver avant la fin de la
// migration, mais ça évite qu'un hébergeur comme Render déclare le déploiement en échec faute
// d'avoir vu le port s'ouvrir à temps si la migration traîne.
migrate().catch((err) => console.error('Échec de la migration au démarrage (ignoré) :', err));

// Alimente prediction_results avec des matchs au-delà de la sélection affichée aux visiteurs
// (voir trackExtraFixturesForData), pour accumuler plus vite les données de calibration —
// jamais dans le chemin d'une requête HTTP, donc sans impact sur la vitesse de chargement.
const BACKGROUND_TRACKING_INTERVAL_MS = 45 * 60 * 1000;

// Résout les pronostics dont le match est terminé (hier + aujourd'hui), indépendamment de
// tout visiteur -> sans ça, un pronostic ne se résout que si quelqu'un recharge /today après
// coup, et reste bloqué "à venir" pour toujours si le site est resté silencieux entre-temps
// (coupure serveur, faible trafic nocturne). Lancé une fois au démarrage (rattrape ce qui
// s'est terminé pendant que le serveur était éteint) puis sur la même minuterie.
resolveRecentResults().catch((err) => console.error('Résolution des résultats au démarrage (ignorée):', err.message));

setInterval(() => {
  const today = new Date().toISOString().split('T')[0];
  trackExtraFixturesForData(today).catch((err) =>
    console.error('Suivi arrière-plan des pronostics (ignoré):', err.message)
  );
  resolveRecentResults().catch((err) => console.error('Résolution des résultats (ignorée):', err.message));
}, BACKGROUND_TRACKING_INTERVAL_MS);
