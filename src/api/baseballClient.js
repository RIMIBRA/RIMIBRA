const { createSportClient } = require('./sportClientFactory');

// Saison MLB = année civile (mars -> octobre), pas de chevauchement comme NHL/NBA
function seasonForDate(dateStr) {
  return new Date(dateStr).getUTCFullYear();
}

module.exports = createSportClient({
  baseUrl: 'https://v1.baseball.api-sports.io',
  namespace: 'baseball',
  seasonFromDate: seasonForDate,
});
