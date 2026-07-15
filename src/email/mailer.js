const nodemailer = require('nodemailer');

// SMTP générique (Gmail avec un mot de passe d'application, ou tout autre fournisseur) plutôt
// qu'un SDK propriétaire -> pas d'engagement vers un fournisseur précis. Absentes en dev local
// tant que le .env n'est pas rempli -> mode no-op silencieux (voir push/webPush.js pour le
// même principe), pas un crash au démarrage.
const configured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let transporter = null;
if (configured) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    // true seulement sur le port 465 (SMTPS direct) ; 587/25 utilisent STARTTLS, géré
    // automatiquement par nodemailer sans ce flag.
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendPasswordResetEmail(to, resetUrl) {
  if (!configured) {
    // Pas de SMTP configuré : on logue le lien en clair UNIQUEMENT hors production, pour
    // pouvoir tester le flux en local sans boîte mail réelle. En prod, un utilisateur qui
    // demande une réinitialisation sans SMTP configuré ne recevra jamais son lien -> le
    // log ci-dessous permet à l'admin de s'en apercevoir dans les logs serveur.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] Lien de réinitialisation pour ${to} : ${resetUrl}`);
    } else {
      console.error('SMTP non configuré : email de réinitialisation non envoyé à', to);
    }
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Réinitialise ton mot de passe — footpredictongoal',
    text: `Tu as demandé à réinitialiser ton mot de passe sur footpredictongoal.\n\n`
      + `Clique sur ce lien (valable 1 heure) : ${resetUrl}\n\n`
      + `Si tu n'es pas à l'origine de cette demande, ignore simplement cet email — `
      + `ton mot de passe actuel reste inchangé.`,
    html: `
      <p>Tu as demandé à réinitialiser ton mot de passe sur <strong>footpredictongoal</strong>.</p>
      <p><a href="${resetUrl}">Clique ici pour choisir un nouveau mot de passe</a> (lien valable 1 heure).</p>
      <p style="color:#888;font-size:0.85rem">Si tu n'es pas à l'origine de cette demande, ignore simplement cet email — ton mot de passe actuel reste inchangé.</p>
    `,
  });
}

module.exports = { sendPasswordResetEmail, configured };
