/* Accès Supabase via son API REST (PostgREST + Storage), en fetch natif.
   Aucune dépendance npm : le dépôt reste sans étape d'installation.

   La clé `service_role` contourne le RLS. Elle ne doit JAMAIS être exposée au
   navigateur : elle n'est lue que dans ces fonctions serverless. */

/* L'adresse du projet est un simple domaine : https://xxxxxxxx.supabase.co
   Les pages de réglages de Supabase affichent aussi l'adresse de l'API REST,
   avec « /rest/v1 » à la fin. Coller celle-ci enverrait toutes les requêtes
   vers .../rest/v1/rest/v1/... et .../rest/v1/storage/v1/..., que PostgREST
   rejette avec un PGRST125. On ne garde donc que le domaine, et on ajoute le
   protocole s'il manque. */
export function normaliserBase(brut) {
  let valeur = String(brut || '').trim();
  if (!valeur) return '';
  if (!/^https?:\/\//i.test(valeur)) valeur = 'https://' + valeur;
  try {
    return new URL(valeur).origin;
  } catch {
    return valeur.replace(/\/+$/, '');
  }
}

const base = () => normaliserBase(process.env.SUPABASE_URL);
const cle = () => String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

function entetes(extra) {
  return Object.assign({
    apikey: cle(),
    Authorization: 'Bearer ' + cle()
  }, extra || {});
}

async function echec(reponse, contexte) {
  let detail = '';
  try { detail = await reponse.text(); } catch { /* corps illisible */ }
  throw new Error(contexte + ' — HTTP ' + reponse.status + ' ' + detail.slice(0, 500));
}

/* --------------------------------------------------------------------------
   Table « dossiers »
   -------------------------------------------------------------------------- */

const TABLE = '/rest/v1/dossiers';

export async function insererDossier(ligne) {
  const r = await fetch(base() + TABLE, {
    method: 'POST',
    headers: entetes({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(ligne)
  });
  // 23505 = violation de contrainte unique (numéro déjà pris) : l'appelant réessaie.
  if (r.status === 409) return null;
  if (!r.ok) await echec(r, 'insererDossier');
  const lignes = await r.json();
  return lignes[0];
}

export async function majDossier(numero, patch) {
  const r = await fetch(base() + TABLE + '?numero=eq.' + encodeURIComponent(numero), {
    method: 'PATCH',
    headers: entetes({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(patch)
  });
  if (!r.ok) await echec(r, 'majDossier');
  const lignes = await r.json();
  return lignes[0] || null;
}

export async function lireDossier(numero) {
  const r = await fetch(
    base() + TABLE + '?numero=eq.' + encodeURIComponent(numero) + '&limit=1',
    { headers: entetes() }
  );
  if (!r.ok) await echec(r, 'lireDossier');
  const lignes = await r.json();
  return lignes[0] || null;
}

export async function listerDossiers(statut) {
  let url = base() + TABLE + '?select=*&order=cree_le.desc&limit=500';
  if (statut && statut !== 'all') url += '&statut=eq.' + encodeURIComponent(statut);
  const r = await fetch(url, { headers: entetes() });
  if (!r.ok) await echec(r, 'listerDossiers');
  return r.json();
}

export async function compterParStatut() {
  const r = await fetch(base() + TABLE + '?select=statut', { headers: entetes() });
  if (!r.ok) await echec(r, 'compterParStatut');
  const lignes = await r.json();
  const total = { all: lignes.length, pending: 0, approved: 0, rejected: 0 };
  for (const l of lignes) if (l.statut in total) total[l.statut]++;
  return total;
}

/* --------------------------------------------------------------------------
   Limitation des tentatives de connexion
   -------------------------------------------------------------------------- */

const TENTATIVES = '/rest/v1/admin_tentatives';

export async function lireTentatives(ip) {
  const r = await fetch(
    base() + TENTATIVES + '?ip=eq.' + encodeURIComponent(ip) + '&limit=1',
    { headers: entetes() }
  );
  if (!r.ok) await echec(r, 'lireTentatives');
  const lignes = await r.json();
  return lignes[0] || null;
}

export async function ecrireTentatives(ligne) {
  const r = await fetch(base() + TENTATIVES, {
    method: 'POST',
    headers: entetes({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    }),
    body: JSON.stringify(ligne)
  });
  if (!r.ok) await echec(r, 'ecrireTentatives');
}

/* --------------------------------------------------------------------------
   Stockage des preuves (bucket privé « preuves »)
   -------------------------------------------------------------------------- */

const BUCKET = 'preuves';

/* URL de téléversement signée, à usage unique, pour un chemin imposé par le
   serveur. Le navigateur y dépose le fichier directement : les octets ne
   transitent pas par la fonction serverless, ce qui évite la limite de
   4,5 Mo sur le corps des requêtes Vercel. */
export async function urlTeleversementSignee(chemin) {
  const r = await fetch(
    base() + '/storage/v1/object/upload/sign/' + BUCKET + '/' + chemin,
    {
      method: 'POST',
      headers: entetes({ 'Content-Type': 'application/json' }),
      // Corps `{}` obligatoire : annoncer application/json sans corps fait
      // échouer l'analyse côté Storage. Le client officiel envoie bien {}.
      body: '{}'
    }
  );
  if (!r.ok) await echec(r, 'urlTeleversementSignee');
  const { url } = await r.json();
  return base() + '/storage/v1' + url;
}

export async function telechargerPreuve(chemin) {
  const r = await fetch(base() + '/storage/v1/object/' + BUCKET + '/' + chemin, {
    headers: entetes()
  });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) await echec(r, 'telechargerPreuve');
  return {
    octets: Buffer.from(await r.arrayBuffer()),
    type: r.headers.get('content-type') || 'application/octet-stream'
  };
}

export async function supprimerPreuve(chemin) {
  // La suppression se fait par lot sur le bucket, avec la liste des chemins
  // dans le corps — c'est la forme qu'utilise le client officiel.
  const r = await fetch(base() + '/storage/v1/object/' + BUCKET, {
    method: 'DELETE',
    headers: entetes({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: [chemin] })
  });
  // 404 : le fichier n'existe plus, le résultat voulu est déjà atteint.
  if (!r.ok && r.status !== 404) await echec(r, 'supprimerPreuve');
}
