// Config PM2 : redémarre automatiquement le serveur s'il plante, ce qui manquait jusqu'ici
// (aucun process manager -> un crash = arrêt total jusqu'à relance manuelle). Voir README/discussion :
// pool.on('error') et unhandledRejection réduisent déjà les crashs, ceci couvre tout le reste.
module.exports = {
  apps: [
    {
      name: 'rimibra',
      script: 'src/server.js',
      instances: 1,
      autorestart: true,
      // Attend 5s avant de relancer -> évite une boucle de redémarrage effrénée si la panne
      // est persistante (ex : DB injoignable), qui saturerait sinon le CPU et les logs
      restart_delay: 5000,
      // Au-delà, PM2 arrête de réessayer -> mieux vaut un service resté éteint et visible
      // (pm2 status affiche "errored") qu'une boucle de crash infinie et silencieuse
      max_restarts: 20,
      min_uptime: '30s',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
