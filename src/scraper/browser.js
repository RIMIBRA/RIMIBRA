// Singleton Puppeteer avec plugin stealth — un seul Chromium pour toute l'app
// Le navigateur reste ouvert entre les requêtes pour éviter le coût de relancement (~2s)
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

let _browser = null;
let _launching = null; // Promise en cours si lancement en parallèle

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,800',
];

async function getBrowser() {
  if (_browser && _browser.connected) return _browser;

  // Éviter plusieurs lancements simultanés (plusieurs requêtes en parallèle)
  if (_launching) return _launching;

  _launching = puppeteer.launch({
    headless: 'new',
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1280, height: 800 },
  }).then((b) => {
    _browser = b;
    _launching = null;
    _browser.on('disconnected', () => { _browser = null; });
    return _browser;
  }).catch((err) => {
    _launching = null;
    throw err;
  });

  return _launching;
}

async function newPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // En-têtes réalistes pour passer les checks basiques anti-bot
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  });

  await page.setDefaultNavigationTimeout(15000);
  await page.setDefaultTimeout(10000);
  return page;
}

// Nettoyage propre à la fermeture du process
process.on('exit', () => { if (_browser) _browser.close().catch(() => {}); });
process.on('SIGINT', () => { if (_browser) _browser.close().catch(() => {}); process.exit(); });

module.exports = { getBrowser, newPage };
