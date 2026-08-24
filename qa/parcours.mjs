/* Suite de tests de bout en bout — voir README.md § Tests.
   Sert le site sur un port local, puis déroule le parcours complet. */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(4321, r));

const results = [];
const ok = (name, cond, extra = '') => results.push({ name, pass: !!cond, extra });

// PW_CHROMIUM permet de pointer un binaire déjà présent sur la machine.
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}
);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-FR' });
const page = await ctx.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:4321/', { waitUntil: 'networkidle' });

/* ---------- 1. Statique ---------- */
ok('titre de page', (await page.title()).includes('Permis Express'));
ok('pas de lien wa.me', (await page.content()).includes('wa.me') === false);
ok('8 cartes tarifs', (await page.locator('#tarifsGrid .card-tarif').count()) === 8);
ok('6 avis', (await page.locator('.card-review').count()) === 6);
ok('6 questions FAQ', (await page.locator('.faq-item').count()) === 6);
ok('galerie masquée', await page.locator('#galerie').isHidden());
ok('section suivi visible', await page.locator('#suivi').isVisible());
ok('bandeau promo visible', await page.locator('#promoBar').isVisible());
ok('prix Permis B = 800 €', (await page.locator('[data-permit="B"].card-tarif .card-tarif__price').textContent()).trim() === '800 €');

/* FAQ accordéon : première ouverte, exclusive */
ok('FAQ 1 ouverte au chargement', await page.locator('.faq-item').first().evaluate(n => n.open));
await page.locator('.faq-item').nth(2).locator('summary').click();
ok('FAQ exclusive', !(await page.locator('.faq-item').first().evaluate(n => n.open))
  && await page.locator('.faq-item').nth(2).evaluate(n => n.open));

/* ---------- 2. Parcours ---------- */
await page.locator('.card-tarif[data-permit="A2"] [data-action="choose"]').click();
ok('parcours ouvert à l\'étape 2', await page.locator('.funnel-step[data-step="2"]').isVisible());
ok('permis retenu = A2', (await page.locator('.chosen-tag').textContent()).includes('Permis A2'));

/* Validation : champs vides */
await page.locator('[data-action="submit-info"]').click();
ok('alerte de validation', await page.locator('#formAlert').isVisible());
ok('erreur prénom', (await page.locator('#e-prenom').textContent()).length > 0);
ok('reste à l\'étape 2', await page.locator('.funnel-step[data-step="2"]').isVisible());

/* E-mail / téléphone invalides */
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

/* Retour arrière : les valeurs sont conservées */
await page.locator('[data-action="edit-info"]').click();
ok('valeurs conservées au retour', (await page.inputValue('#f-ville')) === 'Paris');
await page.locator('[data-action="submit-info"]').click();

/* ---------- 3. Paiement ---------- */
await page.locator('[data-action="to-pay"]').click();
ok('étape paiement', await page.locator('.funnel-step[data-step="4"]').isVisible());
ok('bouton confirmer masqué sans moyen', await page.locator('#confirmWrap').isHidden());

await page.locator('[data-action="pick-method"][data-method="vir"]').click();
ok('panneau virement affiché', await page.locator('[data-pay-panel="vir"]').isVisible());
ok('confirmer désactivé sans preuve', await page.locator('[data-action="confirm"]').isDisabled());
ok('message preuve obligatoire', (await page.locator('#confirmHint').textContent()).includes('obligatoire'));
ok('référence de virement', (await page.locator('[data-bind="payRef"]').first().textContent()).trim() === 'PE-DURAND');

await page.locator('[data-action="declare"]:visible').click();
ok('virement déclaré', (await page.locator('[data-pay-panel="vir"] .declare-btn').textContent()).includes('déclaré'));

/* Preuve PDF */
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>');
await page.locator('[data-pay-panel="vir"] [data-proof-input]').setInputFiles({ name: 'recu.pdf', mimeType: 'application/pdf', buffer: pdf });
ok('nom de la preuve affiché', (await page.locator('[data-pay-panel="vir"] [data-proof-name]').textContent()).includes('recu.pdf'));
ok('confirmer activé', !(await page.locator('[data-action="confirm"]').isDisabled()));

/* Changer de moyen de paiement remet la preuve à zéro */
await page.locator('[data-action="pick-method"][data-method="wu"]').click();
ok('preuve réinitialisée au changement', await page.locator('[data-action="confirm"]').isDisabled());
ok('panneau WU affiché', await page.locator('[data-pay-panel="wu"]').isVisible());
await page.fill('#f-mtcn', '1234567890');
await page.locator('[data-action="pick-method"][data-method="vir"]').click();
await page.locator('[data-pay-panel="vir"] [data-proof-input]').setInputFiles({ name: 'recu.pdf', mimeType: 'application/pdf', buffer: pdf });

await page.locator('[data-action="confirm"]').click();
ok('page de confirmation', await page.locator('.funnel-step[data-step="5"]').isVisible());
const done = await page.locator('.funnel-step[data-step="5"]').innerText();
const dossier = (done.match(/PE-\d{4}-\d{4}/) || [])[0];
ok('numéro de dossier généré', !!dossier, dossier);
ok('statut = preuve envoyée', done.includes('Preuve envoyée'));
ok('facture FA-', done.includes(dossier?.replace('PE-', 'FA-') ?? '###'));
ok('merci + prénom', done.includes('Merci Chloé'));
ok('montant 650 €', done.includes('650 €'));

/* ---------- 4. Persistance ---------- */
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pe_dossiers_v1') || '[]'));
ok('1 dossier stocké', stored.length === 1);
ok('dossier en attente', stored[0]?.status === 'pending');
ok('preuve stockée', (stored[0]?.proofData || '').startsWith('data:application/pdf'));

await page.locator('.overlay__close[data-action="funnel-close"]').click();
ok('retour au site', await page.locator('#funnelOverlay').isHidden());

/* ---------- 5. Administration ---------- */
await page.locator('[data-action="admin"]').click();
ok('portail admin', await page.locator('#adminGate').isVisible());
await page.fill('#adminPass', 'mauvais');
await page.locator('[data-action="admin-login"]').click();
ok('mauvais code refusé', (await page.locator('#adminError').textContent()).includes('incorrect'));
await page.fill('#adminPass', '#Capaciteur200K#');
await page.locator('[data-action="admin-login"]').click();
ok('admin déverrouillé', await page.locator('#adminBody').isVisible());
ok('portail de connexion masqué', await page.locator('#adminGate').isHidden());
ok('1 dossier listé', (await page.locator('.admin-card').count()) === 1);

const card = await page.locator('.admin-card').first().innerText();
ok('admin : client', card.includes('Chloé Durand'));
ok('admin : e-mail', card.includes('chloe@exemple.fr'));
ok('admin : MTCN absent (virement)', !card.includes('MTCN'));
ok('admin : aperçu PDF en iframe', (await page.locator('.admin-proof__view iframe').count()) === 1);
ok('admin : bouton téléchargement', await page.locator('.admin-proof__download').isVisible());

/* Rejet sans motif : refusé */
await page.locator('.btn-reject').click();
ok('rejet sans motif bloqué', (await page.locator('[data-decide-error]').textContent()).includes('raison'));
ok('dossier toujours en attente', (await page.locator('.admin-card__pill').textContent()).includes('En attente'));

await page.fill('.admin-decide textarea', 'Reçu illisible, merci de renvoyer une photo nette.');
await page.locator('.btn-reject').click();
ok('dossier rejeté', (await page.locator('.admin-card__pill').textContent()).includes('rejetée'));
ok('carte verrouillée', await page.locator('.admin-locked').isVisible());
ok('décision affichée', (await page.locator('.admin-decision').innerText()).includes('illisible'));
ok('plus de boutons de décision', (await page.locator('.btn-reject').count()) === 0);

/* Filtres */
await page.locator('[data-filter="pending"]').click();
ok('filtre En attente vide', await page.locator('#adminEmpty').isVisible());
ok('compteur rejetées = 1', (await page.locator('[data-filter="rejected"]').textContent()).includes('(1)'));
await page.locator('[data-filter="all"]').click();
await page.locator('[data-action="admin-close"]').click();

/* ---------- 6. Suivi client ---------- */
await page.locator('#suivi [data-action="track"]').click();
ok('modale de suivi', await page.locator('#trackOverlay').isVisible());
await page.fill('#trackInput', 'PE-0000-0000');
await page.locator('[data-action="track-run"]').click();
ok('dossier inconnu signalé', (await page.locator('#trackError').textContent()).includes('Aucun dossier'));

await page.fill('#trackInput', dossier.toLowerCase());
await page.locator('[data-action="track-run"]').click();
ok('dossier trouvé (insensible à la casse)', await page.locator('#trackResult').isVisible());
ok('statut rejeté affiché', (await page.locator('#trackStatus').textContent()).includes('rejetée'));
ok('message admin visible', (await page.locator('#trackNote').textContent()).includes('illisible'));
ok('bouton renvoi visible', await page.locator('#trackRetryWrap').isVisible());

/* ---------- 7. Renvoi d'une preuve ---------- */
await page.locator('[data-action="track-retry"]').click();
ok('retour à l\'étape paiement', await page.locator('.funnel-step[data-step="4"]').isVisible());
ok('permis restauré', (await page.locator('[data-bind="montant"]').first().textContent()).includes('650 €'));
ok('formulaire restauré', (await page.inputValue('#f-nom')) === 'Durand');
ok('preuve remise à zéro', await page.locator('[data-action="confirm"]').isDisabled());

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex');
await page.locator('[data-pay-panel="vir"] [data-proof-input]').setInputFiles({ name: 'recu.png', mimeType: 'image/png', buffer: png });
await page.locator('[data-action="confirm"]').click();
const done2 = await page.locator('.funnel-step[data-step="5"]').innerText();
ok('même numéro de dossier', done2.includes(dossier));

const stored2 = await page.evaluate(() => JSON.parse(localStorage.getItem('pe_dossiers_v1') || '[]'));
ok('toujours 1 dossier', stored2.length === 1);
ok('repassé en attente', stored2[0].status === 'pending');
ok('décision archivée', (stored2[0].history || []).length === 1 && stored2[0].history[0].status === 'rejected');
ok('badge nouvelle preuve', !!stored2[0].resubmittedAt);
ok('nouvelle preuve PNG', (stored2[0].proofData || '').startsWith('data:image/png'));

/* L'admin peut à nouveau trancher, et le message précédent n'est pas réutilisé */
await page.locator('.overlay__close[data-action="funnel-close"]').click();
await page.locator('[data-action="admin"]').click();
ok('décision de nouveau possible', (await page.locator('.btn-approve').count()) === 1);
ok('champ message vidé', (await page.inputValue('.admin-decide textarea')) === '');
ok('aperçu image', (await page.locator('.admin-proof__view img').count()) === 1);
ok('historique affiché', (await page.locator('.admin-history').innerText()).includes('Rejeté'));
await page.locator('.btn-approve').click();
ok('validé sans message (défaut)', (await page.locator('.admin-decision').innerText()).includes('vérifié et validé'));
await page.locator('[data-action="admin-close"]').click();

/* ---------- 8. Accessibilité / clavier ---------- */
await page.keyboard.press('Escape');
await page.locator('#suivi [data-action="track"]').click();
await page.keyboard.press('Escape');
ok('Échap ferme la modale', await page.locator('#trackOverlay').isHidden());
ok('défilement rétabli', (await page.evaluate(() => document.body.style.overflow)) === '');

/* ---------- 9. Mobile ---------- */
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
ok('burger visible en mobile', await m.locator('#burger').isVisible());
ok('nav desktop masquée', await m.locator('.nav-desktop').isHidden());
await m.locator('#burger').click();
ok('menu mobile ouvert', await m.locator('#navMobile').isVisible());
ok('aria-expanded', (await m.locator('#burger').getAttribute('aria-expanded')) === 'true');
await m.locator('#navMobile a').first().click();
ok('menu refermé après clic', await m.locator('#navMobile').isHidden());
const overflowX = await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
ok('pas de débordement horizontal (mobile)', overflowX);
await m.locator('.card-tarif[data-permit="B"] [data-action="choose"]').click();
ok('parcours utilisable en mobile', await m.locator('.funnel-step[data-step="2"]').isVisible());
const overflowX2 = await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
ok('pas de débordement (parcours mobile)', overflowX2);

/* Tablette */
const t = await ctx.newPage();
await t.setViewportSize({ width: 820, height: 1180 });
await t.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
ok('hero empilé en tablette', await t.evaluate(() =>
  getComputedStyle(document.querySelector('.hero-inner')).gridTemplateColumns.split(' ').length === 1));
const overflowX3 = await t.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
ok('pas de débordement (tablette)', overflowX3);

// fonts.googleapis.com est injoignable dans ce bac à sable : on l'exclut.
const realErrors = errors.filter(e => !/fonts\.googleapis\.com|ERR_CONNECTION_RESET/.test(e));

/* ---------- 10. Divers ---------- */
await page.locator('[data-action="start"]').first().click();
// Un permis est déjà retenu : le parcours s'ouvre à l'étape 2, on remonte.
await page.locator('.chosen-line [data-action="back-permit"]').click();
await page.locator('[data-action="pick-permit"][data-permit="CODE"]').click();
await page.locator('.chosen-line [data-action="back-permit"]').click();
ok('retour étape 1 : permis coché', (await page.locator('.pick[data-permit="CODE"]').getAttribute('aria-pressed')) === 'true');
await page.locator('.overlay__close[data-action="funnel-close"]').click();

/* Le catalogue statique et PERMITS doivent concorder (aucun avertissement) */
const warns = [];
page.on('console', m => { if (m.type() === 'warning') warns.push(m.text()); });
await page.reload({ waitUntil: 'networkidle' });
ok('catalogue cohérent (aucun avertissement)', warns.length === 0, warns.join(' | '));

/* Les polices sont bien locales : aucune requête tierce */
const hosts = new Set();
page.on('request', r => { const u = new URL(r.url()); if (u.hostname !== 'localhost') hosts.add(u.hostname); });
await page.reload({ waitUntil: 'networkidle' });
ok('aucune requête vers un domaine tiers', hosts.size === 0, [...hosts].join(', '));
ok('Archivo chargé', await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('900 56px Archivo'); }));

ok('aucune erreur console', realErrors.length === 0, realErrors.join(' | '));

await browser.close();
server.close();

const failed = results.filter(r => !r.pass);
results.forEach(r => console.log((r.pass ? '  ok   ' : '  FAIL ') + r.name + (r.extra ? '  → ' + r.extra : '')));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' tests réussis');
process.exit(failed.length ? 1 : 0);
