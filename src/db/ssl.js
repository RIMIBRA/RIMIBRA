// Sur l'URL interne Render (hostname court sans domaine, ex: "dpg-xxxxx-a"), la clé "ssl" ne
// doit même pas être présente dans la config pg : passer explicitement ssl:false bloque
// indéfiniment toute requête (comportement différent de ne pas préciser ssl du tout). Tout
// hôte externe (Render externe, Supabase, Aiven, ElephantSQL...) a un nom de domaine avec au
// moins un point et exige TLS ; localhost n'en a pas besoin non plus.
function needsSsl(connectionString) {
  if (!connectionString) return false;
  try {
    const { hostname } = new URL(connectionString);
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname.includes('.');
  } catch {
    return false;
  }
}

// pg-connection-string traite désormais sslmode=require (présent par défaut dans les URI
// fournies par Aiven, Supabase...) comme un alias de verify-full, et ÉCRASE silencieusement
// le ssl:{rejectUnauthorized:false} qu'on passe explicitement à Pool — provoquant
// "self-signed certificate in certificate chain" dès que le certificat du fournisseur n'est
// pas signé par une CA du magasin de confiance par défaut de Node. On retire sslmode de l'URL
// pour que seule notre config ssl explicite s'applique.
function stripSslMode(connectionString) {
  if (!connectionString) return connectionString;
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString;
  }
}

// Config prête à passer à `new Pool(...)` : connectionString nettoyée + ssl seulement si requis.
function pgPoolConfig(connectionString) {
  const config = { connectionString: stripSslMode(connectionString) };
  if (needsSsl(connectionString)) config.ssl = { rejectUnauthorized: false };
  return config;
}

module.exports = { needsSsl, stripSslMode, pgPoolConfig };
