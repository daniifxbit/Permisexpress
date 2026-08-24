/* GET /api/diagnostic — page de contrôle de la configuration.

   Destinée à l'exploitant du site : elle vérifie, dans l'ordre, chaque
   condition nécessaire au fonctionnement du parcours, et dit en clair ce qui
   manque. Le test du stockage effectue un aller-retour complet — demande
   d'URL signée, dépôt, relecture, suppression — car c'est précisément là que
   les erreurs se logent.

   Aucun secret n'est affiché : uniquement des états, et des messages d'erreur
   expurgés de l'adresse du projet. */

import crypto from 'node:crypto';
import {
  listerDossiers, lireTentatives,
  urlTeleversementSignee, telechargerPreuve, supprimerPreuve
} from './_lib/supabase.js';
import { methodes } from './_lib/http.js';

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* PostgREST répond PGRST125 quand le chemin demandé ne lui correspond pas :
   le symptôme d'une adresse de projet contenant déjà « /rest/v1 ». Le remède
   n'est alors pas de recréer les tables. */
function remede(e, parDefaut) {
  if (String(e && e.message).includes('PGRST125')) {
    return 'L\'adresse SUPABASE_URL contient un chemin en trop. Elle doit se limiter au '
      + 'domaine, du type https://xxxxxxxx.supabase.co — sans /rest/v1 ni rien après. '
      + 'Corrigez-la dans Vercel, puis redéployez.';
  }
  return parDefaut;
}

/* Retire tout ce qui pourrait identifier le projet ou porter un secret. */
function expurger(message) {
  let texte = String(message || '');
  const url = process.env.SUPABASE_URL;
  if (url) texte = texte.split(url).join('[adresse du projet]');
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (cle) texte = texte.split(cle).join('[clé]');
  return texte.replace(/eyJ[A-Za-z0-9_.-]{20,}/g, '[jeton]').slice(0, 240);
}

export default async function handler(req, res) {
  if (!methodes(req, res, ['GET'])) return;

  const controles = [];
  const ajouter = (nom, etat, detail, conseil) =>
    controles.push({ nom, etat, detail, remede: conseil });

  /* ---- 1. Variables d'environnement ---- */
  const url = process.env.SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const empreinteAdmin = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.SESSION_SECRET;

  /* Erreur de saisie fréquente : coller l'adresse de l'API REST, qui se termine
     par « /rest/v1 », au lieu de l'adresse du projet. Le code l'ignore, mais on
     le signale pour que la variable soit remise au propre. */
  let cheminEnTrop = false;
  if (url) {
    try {
      const analysee = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url);
      cheminEnTrop = analysee.pathname.replace(/\/+$/, '') !== '';
    } catch { /* adresse illisible : signalée ci-dessous */ }
  }

  ajouter('Adresse du projet Supabase', url ? 'ok' : 'ko',
    !url ? 'absente'
      : cheminEnTrop ? 'renseignée, mais elle contient un chemin en trop — seul le domaine est utilisé'
      : 'renseignée',
    'Ajoutez SUPABASE_URL dans Vercel → Settings → Environment Variables, puis redéployez. '
    + 'Elle doit se limiter au domaine, du type https://xxxxxxxx.supabase.co — sans /rest/v1 à la fin.');

  ajouter('Clé d\'accès Supabase', cle ? 'ok' : 'ko',
    cle ? 'renseignée' : 'absente',
    'Ajoutez SUPABASE_SERVICE_ROLE_KEY (Supabase → Project Settings → API Keys → service_role), puis redéployez.');

  const empreinteValide = Boolean(empreinteAdmin && empreinteAdmin.startsWith('scrypt$') &&
    empreinteAdmin.split('$').length === 6);
  ajouter('Code d\'accès administrateur', empreinteValide ? 'ok' : 'ko',
    !empreinteAdmin ? 'absent' : empreinteValide ? 'format correct' : 'format inattendu',
    'ADMIN_PASSWORD_HASH doit commencer par « scrypt$ ». Regénérez-le avec npm run code-admin.');

  ajouter('Secret de session', secret && secret.length >= 32 ? 'ok' : 'ko',
    !secret ? 'absent' : secret.length < 32 ? 'trop court (32 caractères minimum)' : 'correct',
    'Sans SESSION_SECRET, la confirmation de demande échoue et la connexion administrateur est impossible.');

  /* ---- 2. Base de données ---- */
  if (url && cle) {
    try {
      await listerDossiers('all');
      ajouter('Table des dossiers', 'ok', 'accessible', '');
    } catch (e) {
      ajouter('Table des dossiers', 'ko', expurger(e.message),
        remede(e, 'Exécutez le script supabase/schema.sql dans Supabase → SQL Editor.'));
    }

    try {
      await lireTentatives('diagnostic');
      ajouter('Table des tentatives de connexion', 'ok', 'accessible', '');
    } catch (e) {
      ajouter('Table des tentatives de connexion', 'ko', expurger(e.message),
        remede(e, 'Exécutez le script supabase/schema.sql dans Supabase → SQL Editor.'));
    }

    /* ---- 3. Stockage des preuves : aller-retour complet ---- */
    const chemin = 'diagnostic/' + crypto.randomUUID() + '.pdf';
    const contenu = Buffer.from('%PDF-1.4 diagnostic');
    let urlDepot = null;

    try {
      urlDepot = await urlTeleversementSignee(chemin);
      ajouter('Autorisation de dépôt de fichier', 'ok', 'obtenue', '');
    } catch (e) {
      ajouter('Autorisation de dépôt de fichier', 'ko', expurger(e.message),
        remede(e, 'Le bucket « preuves » est absent : exécutez supabase/schema.sql dans Supabase → SQL Editor.'));
    }

    if (urlDepot) {
      let depose = false;
      try {
        const r = await fetch(urlDepot, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: contenu
        });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()));
        depose = true;
        ajouter('Dépôt d\'un fichier de test', 'ok', contenu.length + ' octets envoyés', '');
      } catch (e) {
        ajouter('Dépôt d\'un fichier de test', 'ko', expurger(e.message),
          'Vérifiez que le bucket « preuves » accepte les PDF et les images (script supabase/schema.sql).');
      }

      if (depose) {
        try {
          const relu = await telechargerPreuve(chemin);
          if (!relu) throw new Error('fichier introuvable après dépôt');
          if (relu.octets.toString() !== contenu.toString()) throw new Error('contenu différent');
          ajouter('Relecture du fichier de test', 'ok', 'contenu identique', '');
        } catch (e) {
          ajouter('Relecture du fichier de test', 'ko', expurger(e.message),
            'L\'espace administrateur ne pourra pas afficher les preuves de paiement.');
        }

        try {
          // On se fie à la liste renvoyée par le stockage, pas à une relecture :
          // les objets sont servis via un cache, une copie pourrait subsister
          // quelques minutes alors que la suppression a bien eu lieu.
          const { supprimes, statut } = await supprimerPreuve(chemin);
          ajouter('Suppression du fichier de test', supprimes > 0 ? 'ok' : 'ko',
            supprimes > 0
              ? 'nettoyage effectué'
              : 'le stockage n\'a supprimé aucun fichier (réponse HTTP ' + statut + ')',
            supprimes > 0 ? '' :
              'Sans conséquence sur les inscriptions : seules les anciennes preuves ne seront '
              + 'pas purgées après un renvoi. Signalez-le-moi avec le numéro affiché ci-dessus.');
        } catch (e) {
          ajouter('Suppression du fichier de test', 'ko', expurger(e.message),
            'Les anciennes preuves ne seront pas purgées après un renvoi.');
        }
      }
    }
  }

  const echecs = controles.filter((c) => c.etat === 'ko').length;
  const tout = echecs === 0;

  const lignes = controles.map((c) => `
    <li class="ligne ${c.etat}">
      <span class="marque" aria-hidden="true">${c.etat === 'ok' ? '✓' : '✗'}</span>
      <span class="corps">
        <span class="nom">${esc(c.nom)}</span>
        <span class="detail">${esc(c.detail)}</span>
        ${c.etat === 'ko' && c.remede ? `<span class="remede">${esc(c.remede)}</span>` : ''}
      </span>
    </li>`).join('');

  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Diagnostic — Permis Express</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; padding:40px 20px 80px; background:#F3F3F1; color:#12141C;
         font:16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  .shell { max-width:660px; margin:0 auto; }
  .bandeau { height:4px; border-radius:2px; margin-bottom:28px;
             background:linear-gradient(90deg,#1E3F94 0 33%,#F5F5F5 33% 66%,#C1121F 66% 100%); }
  h1 { font-size:26px; margin:0 0 8px; letter-spacing:-.01em; }
  .sous { color:#5A5F6E; margin:0 0 26px; font-size:15px; }
  .verdict { border-radius:12px; padding:18px 20px; margin-bottom:26px; font-size:15.5px; }
  .verdict.bon { background:#EAF7EE; border:1px solid #B6DCC3; color:#1F7A3D; }
  .verdict.mauvais { background:#FDF0EE; border:1px solid #F0C2BA; color:#B42318; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:1px;
       background:#E6E7EC; border:1px solid #E6E7EC; border-radius:12px; overflow:hidden; }
  .ligne { display:flex; gap:14px; padding:16px 20px; background:#fff; align-items:flex-start; }
  .marque { flex:none; width:22px; height:22px; border-radius:50%; display:flex;
            align-items:center; justify-content:center; font-size:13px; font-weight:700; }
  .ok .marque { background:#EAF7EE; color:#1F7A3D; }
  .ko .marque { background:#FDF0EE; color:#B42318; }
  .corps { display:flex; flex-direction:column; gap:3px; min-width:0; }
  .nom { font-weight:600; font-size:15px; }
  .detail { color:#5A5F6E; font-size:14px; word-break:break-word; }
  .remede { color:#B42318; font-size:14px; margin-top:5px; }
  footer { margin-top:28px; color:#8B90A0; font-size:13.5px; }
  @media (prefers-color-scheme: dark) {
    body { background:#0E1016; color:#E7E9F0; }
    .sous, .detail { color:#9AA0AE; }
    ul { background:#272C38; border-color:#272C38; }
    .ligne { background:#171A22; }
    .verdict.bon { background:#16241B; border-color:#2C5A3B; color:#6BC58C; }
    .verdict.mauvais { background:#2A1618; border-color:#5C2B2B; color:#F0938A; }
    .ok .marque { background:#16241B; color:#6BC58C; }
    .ko .marque { background:#2A1618; color:#F0938A; }
    .remede { color:#F0938A; }
    footer { color:#757C8B; }
  }
</style></head><body>
<div class="shell">
  <div class="bandeau"></div>
  <h1>Diagnostic de configuration</h1>
  <p class="sous">Contrôle automatique de tout ce dont le parcours d'inscription a besoin.</p>
  <div class="verdict ${tout ? 'bon' : 'mauvais'}">
    ${tout
      ? '<strong>Tout est en place.</strong> Le parcours d\'inscription, l\'espace administrateur et le suivi de dossier peuvent fonctionner.'
      : `<strong>${echecs} point${echecs > 1 ? 's' : ''} à corriger.</strong> Le détail figure ci-dessous, avec la marche à suivre.`}
  </div>
  <ul>${lignes}</ul>
  <footer>Page rechargeable après chaque correction. Pensez à redéployer sur Vercel
  après toute modification des variables d'environnement.</footer>
</div></body></html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.status(tout ? 200 : 503).send(page);
}
