// Exécute fn sur chaque item avec au plus `limit` exécutions en parallèle —
// remplace les boucles "for...await" séquentielles qui ralentissent inutilement
// l'analyse de matchs indépendants (chacun ne dépend pas du résultat des autres).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

module.exports = { mapWithConcurrency };
