/* Suite de tests de bout en bout — voir README.md § Tests.

   Démarre le banc d'essai (site + vraies fonctions serverless + faux Supabase)
   puis déroule le parcours complet dans un navigateur, plus une série de
   contrôles d'accès effectués directement contre l'API.

   PW_CHROMIUM permet de pointer un binaire Chromium déjà présent. */

import { chromium, request } from 'playwright';
import { demarrer } from './serveur-test.mjs';
import { normaliserBase, supprimerPreuve } from '../api/_lib/supabase.js';
import fs from 'node:fs';

const banc = await demarrer();
const BASE = banc.origine;

const resultats = [];
const ok = (nom, condition, extra = '') => resultats.push({ nom, pass: !!condition, extra });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>');
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154' +
  '789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');

const navigateur = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
);
const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });
const page = await contexte.newPage();

/* Deux appels échouent volontairement pendant les tests (mauvaise adresse
   e-mail, mauvais code d'accès) : le navigateur les journalise comme erreurs
   alors que la page les gère correctement. On les distingue des vraies. */
const ECHECS_ATTENDUS = ['/api/suivi', '/api/admin/login'];

const erreurs = [];
const ressourcesEnEchec = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (m.text().includes('Failed to load resource')) return;   // couvert ci-dessous
  erreurs.push(m.text());
});
page.on('pageerror', (e) => erreurs.push('PAGEERROR: ' + e.message));
page.on('response', (r) => {
  if (r.status() < 400) return;
  const chemin = new URL(r.url()).pathname;
  if (ECHECS_ATTENDUS.includes(chemin)) return;
  ressourcesEnEchec.push(r.status() + ' ' + chemin);
});

/* La liste admin s'affiche en deux temps : « Chargement… », puis les dossiers.
   On attend la fin du chargement avant toute vérification de contenu. */
const listeAdminPrete = () => page.waitForFunction(() => {
  const vide = document.querySelector('#adminEmpty');
  return vide && !vide.textContent.includes('Chargement');
});

await page.goto(BASE + '/', { waitUntil: 'networkidle' });

/* ---------- 1. Page vitrine ---------- */
ok('titre de page', (await page.title()).includes('Permis Express'));
ok('aucun lien wa.me', !(await page.content()).includes('wa.me'));
ok('le code admin n\'est pas dans la page', !(await page.content()).includes('Capaciteur'));
ok('8 cartes tarifs', (await page.locator('#tarifsGrid .card-tarif').count()) === 8);
ok('6 avis', (await page.locator('.card-review').count()) === 6);
ok('6 questions FAQ', (await page.locator('.faq-item').count()) === 6);
ok('galerie masquée', await page.locator('#galerie').isHidden());
ok('section suivi visible', await page.locator('#suivi').isVisible());
ok('prix Permis B = 800 €',
  (await page.locator('.card-tarif[data-permit="B"] .card-tarif__price').textContent()).trim() === '800 €');

ok('FAQ 1 ouverte au chargement', await page.locator('.faq-item').first().evaluate((n) => n.open));
await page.locator('.faq-item').nth(2).locator('summary').click();
ok('FAQ exclusive', !(await page.locator('.faq-item').first().evaluate((n) => n.open))
  && await page.locator('.faq-item').nth(2).evaluate((n) => n.open));

/* Le catalogue vient du serveur */
ok('catalogue chargé depuis l\'API',
  (await page.evaluate(async () => (await (await fetch('/api/catalogue')).json()).permis.length)) === 8);
ok('un seul moyen de paiement au catalogue serveur',
  (await page.evaluate(async () => (await (await fetch('/api/catalogue')).json()).moyens)).length === 1);

/* ---------- 2. Parcours : choix et validation ---------- */
await page.locator('.card-tarif[data-permit="A2"] [data-action="choose"]').click();
ok('parcours ouvert à l\'étape 2', await page.locator('.funnel-step[data-step="2"]').isVisible());
ok('permis retenu = A2', (await page.locator('.chosen-tag').textContent()).includes('Permis A2'));

await page.locator('[data-action="submit-info"]').click();
ok('alerte de validation', await page.locator('#formAlert').isVisible());
ok('erreur prénom', (await page.locator('#e-prenom').textContent()).length > 0);
ok('reste à l\'étape 2', await page.locator('.funnel-step[data-step="2"]').isVisible());

await page.fill('#f-prenom', 'Chloé');
await page.fill('#f-nom', 'Durand');
await page.fill('#f-naissance', '2000-04-12');
await page.fill('#f-tel', '123');
await page.fill('#f-email', 'pas-un-email');
await page.fill('#f-ville', 'Paris');
await page.fill('#f-adresse', '12 rue de Rivoli');
await page.locator('[data-action="submit-info"]').click();
ok('téléphone invalide détecté', (await page.locator('#e-tel').textContent()).includes('invalide'));
ok('e-mail invalide détecté', (await page.locator('#e-email').textContent()).includes('invalide'));

await page.fill('#f-tel', '0612345678');
await page.fill('#f-email', 'chloe@exemple.fr');
await page.locator('[data-action="submit-info"]').click();
ok('passe au récapitulatif', await page.locator('.funnel-step[data-step="3"]').isVisible());

const recap = await page.locator('.funnel-step[data-step="3"]').innerText();
ok('récap : nom', recap.includes('Durand'));
ok('récap : adresse', recap.includes('12 rue de Rivoli'));
ok('récap : prix A2 = 650 €', recap.includes('650 €'));

await page.locator('[data-action="edit-info"]').click();
ok('valeurs conservées au retour', (await page.inputValue('#f-ville')) === 'Paris');
await page.locator('[data-action="submit-info"]').click();

/* ---------- 3. Paiement ---------- */
await page.locator('[data-action="to-pay"]').click();
ok('étape paiement', await page.locator('.funnel-step[data-step="4"]').isVisible());
ok('un seul moyen proposé : grille de choix masquée', await page.locator('#payMethods').isHidden());
ok('titre adapté au moyen unique',
  (await page.locator('#payTitle').textContent()).includes('Réglez votre inscription'));
ok('virement présélectionné', await page.locator('[data-pay-panel="vir"]').isVisible());
ok('bloc de confirmation affiché d\'emblée', await page.locator('#confirmWrap').isVisible());
ok('confirmer désactivé sans preuve', await page.locator('[data-action="confirm"]').isDisabled());
ok('message preuve obligatoire', (await page.locator('#confirmHint').textContent()).includes('obligatoire'));
/* Coordonnées bancaires réelles : la clé IBAN doit rester valide, et
   l'encadré « à compléter » doit avoir disparu. */
{
  const iban = (await page.locator('#bankIban').textContent()).replace(/\s+/g, '').toUpperCase();
  const permute = iban.slice(4) + iban.slice(0, 4);
  const numerique = permute.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let reste = 0;
  for (const chiffre of numerique) reste = (reste * 10 + Number(chiffre)) % 97;
  ok('IBAN affiché : clé valide', reste === 1, 'reste ' + reste);
  ok('IBAN affiché : longueur française', iban.length === 27);
  ok('titulaire renseigné',
    !(await page.locator('#bankHolder').textContent()).includes('à compléter'));
  ok('RIB affiché cohérent avec l\'IBAN',
    (await page.locator('#bankRib').textContent()).replace(/\s+/g, '') === iban.slice(4));
  // On interroge l'attribut `hidden` porté par l'encadré lui-même : son panneau
  // est masqué à cet instant, donc isHidden() serait vrai dans les deux cas.
  ok('encadré « à compléter » retiré du virement',
    await page.locator('#bankTodo').evaluate((n) => n.hidden) === true);
  ok('aucun moyen de paiement sans coordonnées n\'est proposé',
    (await page.locator('[data-pay-panel]').count()) === 1);
}

ok('référence de virement',
  (await page.locator('[data-bind="payRef"]').first().textContent()).trim() === 'PE-DURAND');

await page.locator('[data-pay-panel="vir"] .declare-btn').click();
ok('virement déclaré', (await page.locator('[data-pay-panel="vir"] .declare-btn').textContent()).includes('déclaré'));

await page.locator('[data-pay-panel="vir"] [data-proof-input]')
  .setInputFiles({ name: 'recu.pdf', mimeType: 'application/pdf', buffer: PDF });
ok('nom de la preuve affiché',
  (await page.locator('[data-pay-panel="vir"] [data-proof-name]').textContent()).includes('recu.pdf'));
ok('confirmer activé', !(await page.locator('[data-action="confirm"]').isDisabled()));

/* Une preuve peut être remplacée avant confirmation */
await page.locator('[data-pay-panel="vir"] [data-proof-input]')
  .setInputFiles({ name: 'recu-corrige.pdf', mimeType: 'application/pdf', buffer: PDF });
ok('preuve remplaçable avant confirmation',
  (await page.locator('[data-pay-panel="vir"] [data-proof-name]').textContent()).includes('recu-corrige.pdf'));

await page.locator('[data-action="confirm"]').click();
await page.waitForSelector('.funnel-step[data-step="5"]:not([hidden])', { timeout: 10000 });
const confirmation = await page.locator('.funnel-step[data-step="5"]').innerText();
const dossier = (confirmation.match(/PE-\d{4}-\d{6}/) || [])[0];
ok('numéro de dossier attribué par le serveur', !!dossier, dossier);
ok('statut = preuve envoyée', confirmation.includes('Preuve envoyée'));
ok('facture FA-', confirmation.includes((dossier || '').replace('PE-', 'FA-')));
ok('merci + prénom', confirmation.includes('Merci Chloé'));
ok('montant 650 €', confirmation.includes('650 €'));

/* ---------- 4. Persistance côté serveur ---------- */
ok('1 dossier en base', banc.dossiers.length === 1);
ok('dossier en attente', banc.dossiers[0]?.statut === 'pending');
ok('montant calculé par le serveur', banc.dossiers[0]?.montant === 650);
ok('moyen enregistré = virement bancaire', banc.dossiers[0]?.moyen_id === 'vir');
ok('aucune référence de transfert enregistrée', !banc.dossiers[0]?.reference_wu);
ok('preuve déposée dans le stockage', banc.fichiers.size === 1);
ok('rien n\'est écrit dans le navigateur',
  (await page.evaluate(() => JSON.stringify(Object.keys(localStorage)))) === '[]');

await page.locator('.overlay__close[data-action="funnel-close"]').click();

/* ---------- 5. Suivi client ---------- */
await page.locator('#suivi [data-action="track"]').click();
ok('modale de suivi', await page.locator('#trackOverlay').isVisible());

await page.fill('#trackInput', dossier);
await page.fill('#trackEmail', 'mauvaise@adresse.fr');
await page.locator('[data-action="track-run"]').click();
await page.waitForFunction(() => !document.querySelector('#trackError').textContent.includes('Vérification'));
ok('mauvaise adresse e-mail refusée',
  (await page.locator('#trackError').textContent()).includes('Aucun dossier'));
ok('aucun résultat affiché', await page.locator('#trackResult').isHidden());

await page.fill('#trackEmail', 'chloe@exemple.fr');
await page.locator('[data-action="track-run"]').click();
await page.waitForSelector('#trackResult:not([hidden])');
ok('dossier trouvé avec numéro + e-mail', await page.locator('#trackResult').isVisible());
ok('statut en attente', (await page.locator('#trackStatus').textContent()).includes('attente'));
ok('pas de bouton renvoi tant que non rejeté', await page.locator('#trackRetryWrap').isHidden());
await page.locator('[data-action="track-close"]').click();

/* ---------- 6. Espace administrateur ---------- */
await page.locator('[data-action="admin"]').click();
ok('portail admin', await page.locator('#adminGate').isVisible());

await page.fill('#adminPass', 'mauvais-code');
await page.locator('[data-action="admin-login"]').click();
await page.waitForFunction(() => !document.querySelector('#adminError').textContent.includes('Vérification'));
ok('mauvais code refusé', (await page.locator('#adminError').textContent()).includes('incorrect'));
ok('liste toujours masquée', await page.locator('#adminBody').isHidden());

await page.fill('#adminPass', banc.codeAdmin);
await page.locator('[data-action="admin-login"]').click();
await page.waitForSelector('#adminBody:not([hidden])');
await listeAdminPrete();
ok('admin déverrouillé', await page.locator('#adminBody').isVisible());
ok('portail de connexion masqué', await page.locator('#adminGate').isHidden());
ok('1 dossier listé', (await page.locator('.admin-card').count()) === 1);

const carte = await page.locator('.admin-card').first().innerText();
ok('admin : client', carte.includes('Chloé Durand'));
ok('admin : e-mail', carte.includes('chloe@exemple.fr'));
ok('admin : date de naissance', carte.includes('12/04/2000'));
ok('admin : aperçu PDF en iframe', (await page.locator('.admin-proof__view iframe').count()) === 1);
ok('admin : la preuve passe par l\'API protégée',
  (await page.locator('.admin-proof__view iframe').getAttribute('src')).startsWith('/api/admin/preuve?'));

/* Rejet sans motif : refusé */
await page.locator('.btn-reject').click();
ok('rejet sans motif bloqué', (await page.locator('[data-decide-error]').textContent()).includes('raison'));
ok('dossier toujours en attente', banc.dossiers[0].statut === 'pending');

await page.fill('.admin-decide textarea', 'Reçu illisible, merci de renvoyer une photo nette.');
await page.locator('.btn-reject').click();
await page.waitForFunction(() => document.querySelector('.admin-locked'));
ok('dossier rejeté en base', banc.dossiers[0].statut === 'rejected');
ok('carte verrouillée', await page.locator('.admin-locked').isVisible());
ok('décision affichée', (await page.locator('.admin-decision').innerText()).includes('illisible'));
ok('plus de boutons de décision', (await page.locator('.btn-reject').count()) === 0);

await page.locator('[data-filter="pending"]').click();
await page.waitForFunction(() => document.querySelector('#adminEmpty') && !document.querySelector('#adminEmpty').hidden);
ok('filtre En attente vide', await page.locator('#adminEmpty').isVisible());
ok('compteur rejetées = 1', (await page.locator('[data-filter="rejected"]').textContent()).includes('(1)'));
await page.locator('[data-filter="all"]').click();
await listeAdminPrete();
await page.locator('[data-action="admin-close"]').click();

/* ---------- 7. Renvoi d'une preuve ---------- */
await page.locator('#suivi [data-action="track"]').click();
await page.fill('#trackInput', dossier.toLowerCase());     // insensible à la casse
await page.fill('#trackEmail', 'chloe@exemple.fr');
await page.locator('[data-action="track-run"]').click();
await page.waitForSelector('#trackResult:not([hidden])');
ok('numéro insensible à la casse', await page.locator('#trackResult').isVisible());
ok('statut rejeté affiché', (await page.locator('#trackStatus').textContent()).includes('rejetée'));
ok('message admin visible', (await page.locator('#trackNote').textContent()).includes('illisible'));
ok('bouton renvoi visible', await page.locator('#trackRetryWrap').isVisible());

await page.locator('[data-action="track-retry"]').click();
ok('retour à l\'étape paiement', await page.locator('.funnel-step[data-step="4"]').isVisible());
ok('permis restauré', (await page.locator('[data-bind="montant"]').first().textContent()).includes('650 €'));
ok('preuve remise à zéro', await page.locator('[data-action="confirm"]').isDisabled());

await page.locator('[data-pay-panel="vir"] [data-proof-input]')
  .setInputFiles({ name: 'recu.png', mimeType: 'image/png', buffer: PNG });
await page.locator('[data-action="confirm"]').click();
await page.waitForSelector('.funnel-step[data-step="5"]:not([hidden])', { timeout: 10000 });
ok('même numéro de dossier',
  (await page.locator('.funnel-step[data-step="5"]').innerText()).includes(dossier));
ok('toujours 1 dossier en base', banc.dossiers.length === 1);
ok('repassé en attente', banc.dossiers[0].statut === 'pending');
ok('décision archivée', banc.dossiers[0].historique?.length === 1
  && banc.dossiers[0].historique[0].statut === 'rejected');
ok('horodatage de renvoi', !!banc.dossiers[0].renvoye_le);
ok('nouvelle preuve enregistrée', banc.dossiers[0].preuve_nom === 'recu.png');
ok('ancienne preuve purgée du stockage', banc.fichiers.size === 1);

await page.locator('.overlay__close[data-action="funnel-close"]').click();
await page.locator('[data-action="admin"]').click();
await listeAdminPrete();
ok('décision de nouveau possible', (await page.locator('.btn-approve').count()) === 1);
ok('champ message vidé', (await page.inputValue('.admin-decide textarea')) === '');
ok('aperçu image', (await page.locator('.admin-proof__view img').count()) === 1);
ok('historique affiché', (await page.locator('.admin-history').innerText()).includes('Rejeté'));
ok('badge nouvelle preuve', (await page.locator('.admin-card__resubmit').innerText()).includes('Nouvelle preuve'));

await page.locator('.btn-approve').click();
await page.waitForFunction(() => document.querySelector('.admin-locked'));
ok('validé sans message (texte par défaut)',
  (await page.locator('.admin-decision').innerText()).includes('vérifié et validé'));
ok('statut validé en base', banc.dossiers[0].statut === 'approved');

/* La session survit à la fermeture / réouverture du panneau */
await page.locator('[data-action="admin-close"]').click();
await page.locator('[data-action="admin"]').click();
await page.waitForSelector('#adminBody:not([hidden])');
await listeAdminPrete();
ok('session admin conservée', await page.locator('#adminBody').isVisible());
await page.locator('[data-action="admin-close"]').click();

/* ---------- 8. Contrôles d'accès, directement contre l'API ---------- */
const anonyme = await request.newContext({ baseURL: BASE });

const sansSession = await anonyme.get('/api/admin/dossiers?statut=all');
ok('liste admin refusée sans session', sansSession.status() === 401);

const preuveAnonyme = await anonyme.get('/api/admin/preuve?numero=' + dossier);
ok('preuve refusée sans session', preuveAnonyme.status() === 401);

const decisionAnonyme = await anonyme.post('/api/admin/decision', {
  data: { numero: dossier, statut: 'approved', message: 'test' }
});
ok('décision refusée sans session', decisionAnonyme.status() === 401);

const suiviSansEmail = await anonyme.post('/api/suivi', { data: { numero: dossier } });
ok('suivi refusé sans e-mail', suiviSansEmail.status() === 400);

const suiviMauvaisEmail = await anonyme.post('/api/suivi', {
  data: { numero: dossier, email: 'inconnu@exemple.fr' }
});
ok('suivi refusé avec un e-mail qui ne correspond pas', suiviMauvaisEmail.status() === 404);
ok('la réponse ne révèle pas l\'existence du dossier',
  (await suiviMauvaisEmail.json()).erreur === (await (await anonyme.post('/api/suivi', {
    data: { numero: 'PE-2026-000000', email: 'inconnu@exemple.fr' }
  })).json()).erreur);

const renvoiUsurpe = await anonyme.post('/api/dossiers', {
  data: { numero: dossier, email: 'pirate@exemple.fr', moyen_id: 'vir', preuve: 'faux.jeton' }
});
ok('renvoi de preuve refusé sans jeton valide', renvoiUsurpe.status() === 400);

const preuveForgee = await anonyme.post('/api/dossiers', {
  data: {
    permis_id: 'B', moyen_id: 'vir', preuve: 'charge.signature',
    prenom: 'X', nom: 'Y', naissance: '1990-01-01', email: 'x@y.fr',
    telephone: '0600000000', ville: 'Paris', adresse: 'rue', pays: 'France'
  }
});
ok('jeton de preuve forgé rejeté', preuveForgee.status() === 400);

/* Le montant vient du catalogue serveur, jamais du client */
const urlPreuve = await (await anonyme.post('/api/preuve-url', {
  data: { nom: 'p.pdf', type: 'application/pdf', taille: 1000 }
})).json();
await anonyme.put(urlPreuve.url, { headers: { 'Content-Type': 'application/pdf' }, data: PDF });
const montantForce = await anonyme.post('/api/dossiers', {
  data: {
    permis_id: 'CODE', montant: 1, moyen_id: 'vir', preuve: urlPreuve.jeton,
    prenom: 'Test', nom: 'Montant', naissance: '1990-01-01', email: 'test@exemple.fr',
    telephone: '0600000000', ville: 'Paris', adresse: 'rue', pays: 'France'
  }
});
ok('montant imposé par le serveur, pas par le client',
  (await montantForce.json()).montant === 250);

const typeInterdit = await anonyme.post('/api/preuve-url', {
  data: { nom: 'x.exe', type: 'application/x-msdownload', taille: 1000 }
});
ok('format de preuve non autorisé rejeté', typeInterdit.status() === 400);

const tropGros = await anonyme.post('/api/preuve-url', {
  data: { nom: 'x.pdf', type: 'application/pdf', taille: 50 * 1024 * 1024 }
});
ok('preuve trop volumineuse rejetée', tropGros.status() === 400);

/* Blocage après tentatives répétées */
let dernierStatut = 0;
for (let i = 0; i < 12; i++) {
  const r = await anonyme.post('/api/admin/login', { data: { code: 'faux-' + i } });
  dernierStatut = r.status();
}
ok('connexion admin bloquée après tentatives répétées', dernierStatut === 429);

/* ---------- 9. Accessibilité et mobile ---------- */
await page.keyboard.press('Escape');
await page.locator('#suivi [data-action="track"]').click();
await page.keyboard.press('Escape');
ok('Échap ferme la modale', await page.locator('#trackOverlay').isHidden());
ok('défilement rétabli', (await page.evaluate(() => document.body.style.overflow)) === '');

const mobile = await contexte.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(BASE + '/', { waitUntil: 'networkidle' });
ok('burger visible en mobile', await mobile.locator('#burger').isVisible());
ok('nav desktop masquée', await mobile.locator('.nav-desktop').isHidden());
await mobile.locator('#burger').click();
ok('menu mobile ouvert', await mobile.locator('#navMobile').isVisible());
await mobile.locator('#navMobile a').first().click();
ok('menu refermé après clic', await mobile.locator('#navMobile').isHidden());
ok('pas de débordement horizontal (mobile)',
  await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await mobile.locator('.card-tarif[data-permit="B"] [data-action="choose"]').click();
ok('parcours utilisable en mobile', await mobile.locator('.funnel-step[data-step="2"]').isVisible());
ok('pas de débordement (parcours mobile)',
  await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

const tablette = await contexte.newPage();
await tablette.setViewportSize({ width: 820, height: 1180 });
await tablette.goto(BASE + '/', { waitUntil: 'networkidle' });
ok('hero empilé en tablette', await tablette.evaluate(() =>
  getComputedStyle(document.querySelector('.hero-inner')).gridTemplateColumns.split(' ').length === 1));
ok('pas de débordement (tablette)',
  await tablette.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

/* ---------- 10. Résilience : API injoignable ---------- */
const horsLigne = await contexte.newPage();
await horsLigne.route('**/api/**', (route) => route.abort());
await horsLigne.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await horsLigne.waitForTimeout(400);
ok('tarifs toujours lisibles sans API',
  (await horsLigne.locator('#tarifsGrid .card-tarif').count()) === 8);
await horsLigne.locator('.card-tarif[data-permit="C"] [data-action="choose"]').click();
await horsLigne.locator('.chosen-line [data-action="back-permit"]').click();
ok('catalogue reconstruit depuis la page',
  (await horsLigne.locator('#permitGrid .pick').count()) === 8);

/* ---------- 11. Suppression : on se fie à la liste renvoyée ---------- */
{
  const restants = [...banc.fichiers.keys()];
  const avant = banc.fichiers.size;
  const reel = await supprimerPreuve(restants[0]);
  ok('suppression : le stockage confirme le fichier retiré', reel.supprimes === 1, JSON.stringify(reel));
  ok('suppression : le fichier a bien disparu', banc.fichiers.size === avant - 1);
  const absent = await supprimerPreuve('inexistant/nulle-part.pdf');
  ok('suppression d\'un fichier absent : aucune suppression annoncée', absent.supprimes === 0);
}

/* ---------- 12. Adresse Supabase mal saisie ----------
   Coller l'adresse de l'API REST au lieu de celle du projet envoyait toutes
   les requêtes vers .../rest/v1/rest/v1/… — rejetées par PostgREST. */
[
  ['https://abcd.supabase.co',            'https://abcd.supabase.co'],
  ['https://abcd.supabase.co/',           'https://abcd.supabase.co'],
  ['https://abcd.supabase.co/rest/v1',    'https://abcd.supabase.co'],
  ['https://abcd.supabase.co/rest/v1/',   'https://abcd.supabase.co'],
  ['https://abcd.supabase.co/storage/v1', 'https://abcd.supabase.co'],
  ['  https://abcd.supabase.co/rest/v1 ', 'https://abcd.supabase.co'],
  ['abcd.supabase.co',                    'https://abcd.supabase.co'],
  ['',                                    '']
].forEach(([entree, attendu]) => {
  ok('adresse normalisée : ' + (entree.trim() || '(vide)'),
    normaliserBase(entree) === attendu, normaliserBase(entree));
});

/* ---------- 13. Mentions légales : clés SIRET et TVA ----------
   Les validateurs vivent dans app.js, chargé comme script de page. On extrait
   leur source telle qu'elle est livrée pour l'exécuter ici : un test qui
   réimplémenterait l'algorithme ne prouverait rien sur le code réel. */
{
  const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const extraire = (nom) => {
    const trouve = source.match(new RegExp('\\n  function ' + nom + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}'));
    if (!trouve) throw new Error('fonction ' + nom + ' introuvable dans app.js');
    return trouve[0];
  };
  const { siretValide, tvaValide } = new Function(
    extraire('luhnValide') + extraire('siretValide') + extraire('tvaValide')
    + '\nreturn { siretValide, tvaValide };')();

  /* Jeux d'essai construits, pas empruntés : SIREN à clé de Luhn correcte,
     puis NIC calculé pour que le SIRET complet passe, et clé TVA dérivée. */
  const SIRET_A = '552 032 534 00018', TVA_A = 'FR27552032534';
  const SIRET_B = '552 096 281 00001', TVA_B = 'FR81552096281';

  ok('SIRET valide accepté',                siretValide(SIRET_A));
  ok('SIRET valide accepté (espaces omis)', siretValide(SIRET_A.replace(/ /g, '')));
  ok('SIRET fourni le 24/08 rejeté',        !siretValide('812 345 678 00019'));
  ok('SIRET à un chiffre modifié rejeté',   !siretValide('552 032 534 00019'));
  ok('SIRET au SIREN invalide rejeté',      !siretValide('552 032 535 00018'));
  ok('SIRET trop court rejeté',             !siretValide('552032534'));
  ok('SIRET non numérique rejeté',          !siretValide('55203253400O18'));

  ok('TVA valide acceptée',                 tvaValide(TVA_A, SIRET_A));
  ok('TVA fournie le 24/08 rejetée',        !tvaValide('FR32812345678', '81234567800019'));
  ok('TVA à clé fausse rejetée',            !tvaValide('FR12552032534', SIRET_A));
  ok('TVA d\'un autre SIREN rejetée',       !tvaValide(TVA_B, SIRET_A));
  ok('TVA de format invalide rejetée',      !tvaValide('FR-27-552032534', SIRET_A));
}

ok('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));
ok('aucune ressource en échec', ressourcesEnEchec.length === 0, ressourcesEnEchec.join(' | '));

await navigateur.close();
await banc.arreter();

const echecs = resultats.filter((r) => !r.pass);
resultats.forEach((r) => console.log((r.pass ? '  ok   ' : '  ÉCHEC ') + r.nom + (r.extra ? '  → ' + r.extra : '')));
console.log('\n' + (resultats.length - echecs.length) + '/' + resultats.length + ' tests réussis');
process.exit(echecs.length ? 1 : 0);
