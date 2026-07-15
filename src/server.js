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

// CSP : filet de sécurité pour toute injection HTML qui passerait malgré l'échappement côté
// client (voir escapeHtml dans app.js/admin.js/matchModal.js) — même si une balise <script>
// s'infiltre dans le DOM (ex: nom d'équipe mal échappé), le navigateur refuse de l'exécuter.
// styleSrc autorise 'unsafe-inline' : les templates JS posent des style="" inline partout
// (couleurs, largeurs de barres calculées) — un vrai retrait demanderait de tout migrer vers
// des classes CSS, hors scope ici. imgSrc autorise https: pour les logos d'équipe (servis par
// l'API foot, media.api-sports.io) et data: pour le favicon SVG inline des pages HTML.
// scriptSrcAttr autorise 'unsafe-inline' uniquement pour les attributs onerror="" déjà présents
// (fallback d'image cassée, ex: this.style.display='none') : ils sont écrits en dur par l'app,
// jamais construits à partir de données externes (src/alt sont échappés séparément) -> pas de
// vecteur d'injection rouvert. scriptSrc (les balises <script> elles-mêmes) reste strict.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
}));
// req.rawBody : Buffer exact du corps reçu, nécessaire pour vérifier la signature HMAC des
// webhooks GeniusPay (voir routes/payments.js) — un objet JSON re-sérialisé pourrait différer
// octet à octet de ce que GeniusPay a réellement signé (ordre des clés, espacement...).
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf; } })); // limite la taille du corps des requêtes (anti-DoS basique)
app.use(express.static(path.join(__dirname, '../public')));
app.use(attachUser); // remplit req.user (null si pas de token / token invalide -> traité comme 'free')

// Anti brute-force sur les routes sensibles (login/register/reset) : 10 tentatives / 15 min / IP
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
// Même limiteur pour forgot/reset-password : sans ça, /forgot-password permettrait de spammer
// n'importe quelle boîte mail, et /reset-password de bruteforcer un token à l'aveugle.
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/payments', require('./routes/payments'));

// Endpoint public appelé une fois par chargement de page (voir public/js/analytics.js) : rate
// limit généreux mais présent, pour qu'un visiteur normal ne soit jamais gêné tout en bornant
// l'abus (boucle de faux pageviews qui gonflerait page_views pour rien).
const analyticsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/analytics', analyticsLimiter);
app.use('/api/analytics', require('./routes/analytics'));

// Routes coûteuses (API foot payante à quota journalier + scrapers Puppeteer derrière) : sans
// limite, un script qui matraque /today ou /combos peut épuiser le quota API du jour (plus
// aucune donnée fraîche pour personne) ou saturer le navigateur Puppeteer partagé. Généreux
// pour un visiteur normal (quelques rechargements de page), bloquant pour un abus automatisé.
const predictionsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
// Push/notifications : moins coûteux (pas d'appel API externe) mais toujours exposé sans auth
// pour certaines routes (voir routes/push.js) -> une limite plus large reste utile en filet.
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

// Foot reste accessible en plan gratuit ; les autres sports nécessitent premium ou plus
app.use('/api/predictions', predictionsLimiter, require('./routes/predictions'));
app.use('/api/nfl/predictions', predictionsLimiter, requireSportAccess('nfl'), require('./routes/nflPredictions'));
app.use('/api/nba/predictions', predictionsLimiter, requireSportAccess('nba'), require('./routes/nbaPredictions'));
app.use('/api/hockey/predictions', predictionsLimiter, requireSportAccess('hockey'), require('./routes/hockeyPredictions'));
app.use('/api/baseball/predictions', predictionsLimiter, requireSportAccess('baseball'), require('./routes/baseballPredictions'));
app.use('/api/handball/predictions', predictionsLimiter, requireSportAccess('handball'), require('./routes/handballPredictions'));
app.use('/api/tennis/predictions', predictionsLimiter, requireSportAccess('tennis'), require('./routes/tennisPredictions'));
app.use('/api/combos', predictionsLimiter, require('./routes/combos'));
app.use('/api/push', apiLimiter, require('./routes/push'));
app.use('/api/notifications', apiLimiter, require('./routes/notifications'));

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
