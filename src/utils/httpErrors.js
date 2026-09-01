// err.message peut exposer des détails internes (hostname/port de la base de données, chemin
// de fichier, nom de package...) — jamais sûr à renvoyer tel quel à un visiteur. On loggue le
// détail complet côté serveur pour le diagnostic, et on renvoie un message générique au client.
const DEFAULT_MESSAGE = 'Une erreur est survenue, réessaie dans quelques instants.';

function sendServerError(res, err, message = DEFAULT_MESSAGE) {
  console.error(err);
  res.status(500).json({ error: message });
}

module.exports = { sendServerError };
