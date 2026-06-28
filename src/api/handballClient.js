const { createSportClient } = require('./sportClientFactory');

// Saison Handball = comme le foot, à cheval sur deux années civiles (août -> mai/juin)
function seasonForDate(dateStr) {
  const d = new Date(dateStr);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  return month < 6 ? year - 1 : year;
}

module.exports = createSportClient({
  baseUrl: 'https://v1.handball.api-sports.io',
  namespace: 'handball',
  dailyLimit: 100,
  seasonFromDate: seasonForDate,
});
