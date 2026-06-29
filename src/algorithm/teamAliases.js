// Alias FR -> EN pour les noms de sélections nationales : api-football utilise
// presque toujours le nom anglais, alors que les utilisateurs francophones
// chercheront souvent le nom français du pays.
const ALIASES = {
  'pays-bas': 'netherlands',
  'pays bas': 'netherlands',
  'ouzbékistan': 'uzbekistan',
  'ouzbekistan': 'uzbekistan',
  'allemagne': 'germany',
  'angleterre': 'england',
  'espagne': 'spain',
  "côte d'ivoire": 'ivory coast',
  "cote d'ivoire": 'ivory coast',
  'maroc': 'morocco',
  'sénégal': 'senegal',
  'senegal': 'senegal',
  'égypte': 'egypt',
  'egypte': 'egypt',
  'algérie': 'algeria',
  'algerie': 'algeria',
  'tunisie': 'tunisia',
  'brésil': 'brazil',
  'bresil': 'brazil',
  'argentine': 'argentina',
  'mexique': 'mexico',
  'suisse': 'switzerland',
  'suède': 'sweden',
  'suede': 'sweden',
  'norvège': 'norway',
  'norvege': 'norway',
  'danemark': 'denmark',
  'pologne': 'poland',
  'autriche': 'austria',
  'croatie': 'croatia',
  'belgique': 'belgium',
  'écosse': 'scotland',
  'ecosse': 'scotland',
  'irlande': 'ireland',
  'irlande du nord': 'northern ireland',
  'pays de galles': 'wales',
  'hongrie': 'hungary',
  'grèce': 'greece',
  'grece': 'greece',
  'turquie': 'turkey',
  'russie': 'russia',
  'arabie saoudite': 'saudi arabia',
  'corée du sud': 'south korea',
  'coree du sud': 'south korea',
  'japon': 'japan',
  'chine': 'china',
  'australie': 'australia',
  'nouvelle-zélande': 'new zealand',
  'nouvelle zelande': 'new zealand',
  'cameroun': 'cameroon',
  'nigéria': 'nigeria',
  'nigeria': 'nigeria',
  'afrique du sud': 'south africa',
  'colombie': 'colombia',
  'chili': 'chile',
  'pérou': 'peru',
  'perou': 'peru',
  'équateur': 'ecuador',
  'equateur': 'ecuador',
  'jordanie': 'jordan',
  'émirats arabes unis': 'united arab emirates',
  'emirats arabes unis': 'united arab emirates',
  'irak': 'iraq',
  'jamaïque': 'jamaica',
  'jamaique': 'jamaica',
  'trinité-et-tobago': 'trinidad and tobago',
  'trinite-et-tobago': 'trinidad and tobago',
  'états-unis': 'united states',
  'etats-unis': 'united states',
  'usa': 'united states',
};

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Renvoie les variantes normalisées à comparer (terme original + alias éventuel)
function expandSearchTerms(query) {
  const norm = normalize(query);
  const alias = ALIASES[norm];
  return alias ? [norm, normalize(alias)] : [norm];
}

module.exports = { normalize, expandSearchTerms };
