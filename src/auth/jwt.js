const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
// 30j -> 7j : un token volé (XSS, appareil partagé/volé) reste utilisable un mois entier sans
// aucune possibilité de révocation côté serveur (pas de refresh token ni de version de session
// en base) ; 7j réduit cette fenêtre sans forcer une reconnexion trop fréquente. N'affecte que
// les tokens émis après ce déploi — les sessions déjà ouvertes gardent leur propre expiration.
const EXPIRES_IN = '7d';

function sign(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function verify(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { sign, verify };
