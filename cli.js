require('dotenv').config();
const chalk = require('chalk');
const Table = require('cli-table3');
const { analyzeDayFixtures, analyzeFixture } = require('./src/algorithm/predictor');
const api = require('./src/api/client');

const [, , command, arg] = process.argv;

function colorProb(value) {
  if (value >= 55) return chalk.green.bold(`${value}%`);
  if (value >= 40) return chalk.yellow(`${value}%`);
  return chalk.red(`${value}%`);
}

function confidenceColor(confidence) {
  if (confidence === 'Élevée') return chalk.green(confidence);
  if (confidence === 'Moyenne') return chalk.yellow(confidence);
  return chalk.red(confidence);
}

function printPrediction(p) {
  if (p.error) {
    console.log(chalk.gray(`  ${p.fixture.home} vs ${p.fixture.away} — ${chalk.red('Erreur: ' + p.error)}`));
    return;
  }

  const prob = p.probabilities;
  const rec = p.recommendation;

  console.log(chalk.bold(`\n  ${p.fixture.home} ${chalk.cyan('vs')} ${p.fixture.away}`));
  console.log(`  ${chalk.dim(p.fixture.league)}`);
  console.log(`  ${chalk.dim(new Date(p.fixture.date).toLocaleString('fr-FR'))}`);
  console.log(`  Pronostic: ${chalk.bold.white(rec.pick)}  |  Confiance: ${confidenceColor(rec.confidence)}`);
  console.log(`  1: ${colorProb(prob.home)}  X: ${colorProb(prob.draw)}  2: ${colorProb(prob.away)}`);
  console.log(`  Score algo: ${chalk.blue(p.scores.home)} (dom) — ${chalk.blue(p.scores.away)} (ext)`);

  if (p.breakdown) {
    const b = p.breakdown;
    console.log(chalk.dim(`  Forme: ${b.form.home.score}/100 vs ${b.form.away.score}/100`));
    console.log(chalk.dim(`  H2H: ${b.h2h.summary}`));
    if (b.standings.available) {
      console.log(chalk.dim(`  Classement: #${b.standings.team1.rank} vs #${b.standings.team2.rank}`));
    }
    if (b.injuries.team1.count > 0 || b.injuries.team2.count > 0) {
      console.log(chalk.dim(`  Absents: ${b.injuries.team1.count} (dom) / ${b.injuries.team2.count} (ext)`));
    }
  }

  console.log(chalk.dim('  ' + '─'.repeat(50)));
}

async function cmdToday(date) {
  const target = date || new Date().toISOString().split('T')[0];
  console.log(chalk.bold.cyan(`\n⚽ Pronostics du ${target}`));
  console.log(chalk.dim(`Requêtes API utilisées: ${api.getDailyRequestCount()}/${api.DAILY_LIMIT}\n`));

  const predictions = await analyzeDayFixtures(target);

  if (predictions.length === 0) {
    console.log(chalk.yellow('  Aucun match trouvé pour cette date.'));
    return;
  }

  predictions.forEach(printPrediction);

  const used = api.getDailyRequestCount();
  console.log(chalk.dim(`\nRequêtes utilisées: ${used}/${api.DAILY_LIMIT} — Restantes: ${api.DAILY_LIMIT - used}`));
}

async function cmdFixture(id) {
  if (!id) { console.error(chalk.red('Usage: node cli.js fixture <id>')); process.exit(1); }
  console.log(chalk.bold.cyan(`\n⚽ Analyse du match #${id}`));

  const fixture = await api.getFixtureById(id);
  if (!fixture) { console.error(chalk.red('Match introuvable')); process.exit(1); }

  const p = await analyzeFixture(fixture);
  printPrediction(p);
}

async function cmdStatus() {
  const used = api.getDailyRequestCount();
  const remaining = api.DAILY_LIMIT - used;
  const bar = '█'.repeat(Math.floor(used / 10)) + '░'.repeat(10 - Math.floor(used / 10));

  console.log(chalk.bold.cyan('\n⚽ Statut API'));
  console.log(`  [${used <= 70 ? chalk.green(bar) : used <= 90 ? chalk.yellow(bar) : chalk.red(bar)}]`);
  console.log(`  Utilisées: ${used}/${api.DAILY_LIMIT}`);
  console.log(`  Restantes: ${remaining}`);
}

async function main() {
  if (!process.env.API_FOOTBALL_KEY) {
    console.error(chalk.red('Erreur: API_FOOTBALL_KEY manquante dans .env'));
    process.exit(1);
  }

  switch (command) {
    case 'today':
      await cmdToday(arg);
      break;
    case 'fixture':
      await cmdFixture(arg);
      break;
    case 'status':
      await cmdStatus();
      break;
    default:
      console.log(chalk.bold('\n⚽ Football Predictor — Commandes:'));
      console.log(`  ${chalk.cyan('node cli.js today [YYYY-MM-DD]')}  — Pronostics du jour`);
      console.log(`  ${chalk.cyan('node cli.js fixture <id>')}         — Analyser un match`);
      console.log(`  ${chalk.cyan('node cli.js status')}               — Statut des requêtes API`);
  }
}

main().catch((err) => {
  console.error(chalk.red('Erreur: ' + err.message));
  process.exit(1);
});
