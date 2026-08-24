/* Petits utilitaires partagés par toutes les fonctions serverless. */

export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

/* Message volontairement générique : on ne renvoie jamais au client le détail
   d'une erreur serveur, qui pourrait révéler la structure interne. */
export function erreurServeur(res, contexte, e) {
  console.error('[' + contexte + ']', e && e.stack ? e.stack : e);
  json(res, 500, { erreur: 'Une erreur est survenue. Réessayez dans un instant.' });
}

export function methodes(req, res, autorisees) {
  if (autorisees.includes(req.method)) return true;
  res.setHeader('Allow', autorisees.join(', '));
  json(res, 405, { erreur: 'Méthode non autorisée.' });
  return false;
}

/* Vercel analyse déjà le JSON entrant, mais on reste défensif : selon le
   Content-Type, req.body peut arriver sous forme de chaîne ou de Buffer. */
export function corps(req) {
  const b = req.body;
  if (b == null) return {};
  if (typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  try {
    return JSON.parse(Buffer.isBuffer(b) ? b.toString('utf8') : String(b));
  } catch {
    return null;
  }
}

export function texte(valeur, max) {
  if (typeof valeur !== 'string') return '';
  return valeur.trim().slice(0, max || 200);
}

export function estEmail(valeur) {
  return typeof valeur === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur.trim());
}

/* Adresse du client, derrière le proxy Vercel. */
export function ip(req) {
  const entete = req.headers['x-forwarded-for'];
  const brut = Array.isArray(entete) ? entete[0] : entete;
  return (brut ? String(brut).split(',')[0] : '').trim() || 'inconnue';
}

/* Vrai si les variables d'environnement Supabase sont configurées. Permet de
   renvoyer un message explicite plutôt qu'un plantage opaque. */
export function configuré() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function nonConfiguré(res) {
  json(res, 503, {
    erreur: 'Le service n\'est pas encore configuré. Réessayez plus tard.',
    detail: 'Variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY absentes — voir README.md.'
  });
}
