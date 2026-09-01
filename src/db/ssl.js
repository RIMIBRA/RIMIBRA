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

module.exports = { needsSsl };
