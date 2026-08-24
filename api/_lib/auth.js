/* Authentification administrateur et jetons signés.

   Le code d'accès n'existe nulle part en clair : seul son empreinte scrypt est
   stockée, dans la variable d'environnement ADMIN_PASSWORD_HASH. Le navigateur
   ne reçoit qu'un cookie de session signé, inexploitable pour retrouver le code.

   Générer l'empreinte : node scripts/generer-code-admin.mjs */

import crypto from 'node:crypto';

const COOKIE = 'pe_admin';
const DUREE_SESSION = 8 * 60 * 60 * 1000;   // 8 heures
const DUREE_JETON_PREUVE = 30 * 60 * 1000;  // 30 minutes

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET absent ou trop court (32 caractères minimum).');
  }
  return s;
}

function hmac(donnees) {
  return crypto.createHmac('sha256', secret()).update(donnees).digest('base64url');
}

/* Comparaison à temps constant : une comparaison naïve laisse fuiter, par le
   temps de réponse, le nombre de caractères devinés. */
function egales(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/* --------------------------------------------------------------------------
   Code d'accès
   -------------------------------------------------------------------------- */

export function empreinte(code, sel) {
  const s = sel || crypto.randomBytes(16).toString('base64url');
  const N = 16384, r = 8, p = 1;
  const derivee = crypto.scryptSync(code, s, 32, { N, r, p }).toString('base64url');
  return ['scrypt', N, r, p, s, derivee].join('$');
}

export function codeValide(code) {
  const attendu = process.env.ADMIN_PASSWORD_HASH;
  if (!attendu) throw new Error('ADMIN_PASSWORD_HASH absent.');
  const [algo, N, r, p, sel] = attendu.split('$');
  if (algo !== 'scrypt') throw new Error('ADMIN_PASSWORD_HASH : format inattendu.');
  const calculee = crypto
    .scryptSync(String(code), sel, 32, { N: Number(N), r: Number(r), p: Number(p) })
    .toString('base64url');
  return egales(calculee, attendu.split('$')[5]);
}

/* --------------------------------------------------------------------------
   Session administrateur (cookie signé)
   -------------------------------------------------------------------------- */

export function creerSession() {
  const expire = Date.now() + DUREE_SESSION;
  return 'v1.' + expire + '.' + hmac('v1.' + expire);
}

export function sessionValide(req) {
  const brut = req.headers.cookie || '';
  const trouve = brut.split(';').map(c => c.trim()).find(c => c.startsWith(COOKIE + '='));
  if (!trouve) return false;
  const jeton = decodeURIComponent(trouve.slice(COOKIE.length + 1));
  const [version, expire, signature] = jeton.split('.');
  if (version !== 'v1' || !expire || !signature) return false;
  if (!egales(signature, hmac('v1.' + expire))) return false;
  return Number(expire) > Date.now();
}

export function poserCookie(res) {
  res.setHeader('Set-Cookie', [
    COOKIE + '=' + encodeURIComponent(creerSession()),
    'Path=/',
    'HttpOnly',                 // inaccessible au JavaScript de la page
    'Secure',                   // transmis uniquement en HTTPS
    'SameSite=Strict',          // pas d'envoi depuis un autre site (anti-CSRF)
    'Max-Age=' + Math.floor(DUREE_SESSION / 1000)
  ].join('; '));
}

export function effacerCookie(res) {
  res.setHeader('Set-Cookie',
    COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
}

/* Garde à placer en tête des routes /api/admin/*. */
export function exigeSession(req, res) {
  if (sessionValide(req)) return true;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(401).send(JSON.stringify({ erreur: 'Session expirée ou absente.' }));
  return false;
}

/* --------------------------------------------------------------------------
   Jeton de dépôt de preuve

   Le chemin du fichier est choisi par le serveur puis scellé dans ce jeton.
   Le navigateur le renvoie tel quel avec le dossier : il ne peut donc pas
   désigner le fichier d'un autre client ni écrire ailleurs dans le bucket.
   -------------------------------------------------------------------------- */

export function signerPreuve(donnees) {
  const charge = Buffer.from(JSON.stringify({
    chemin: donnees.chemin,
    nom: donnees.nom,
    type: donnees.type,
    expire: Date.now() + DUREE_JETON_PREUVE
  })).toString('base64url');
  return charge + '.' + hmac(charge);
}

export function verifierPreuve(jeton) {
  if (typeof jeton !== 'string' || !jeton.includes('.')) return null;
  const [charge, signature] = jeton.split('.');
  if (!egales(signature, hmac(charge))) return null;
  let donnees;
  try {
    donnees = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!donnees.expire || donnees.expire < Date.now()) return null;
  return donnees;
}
