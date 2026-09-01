const { createSportClient } = require('./sportClientFactory');

function seasonForDate(dateStr) {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  return month < 7 ? year - 1 : year; // saison NHL "2024" = oct 2024 -> juin 2025
}

module.exports = createSportClient({
  baseUrl: 'https://v1.hockey.api-sports.io',
  namespace: 'hockey',
  seasonFromDate: seasonForDate,
});
