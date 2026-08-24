/* Vérifie que le projet Supabase est correctement configuré.

   Usage :
     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verifier-supabase.mjs

   Le script écrit puis supprime un dossier de test et un fichier de test :
   il ne laisse aucune trace. À lancer une fois après avoir exécuté
   supabase/schema.sql, pour valider la configuration avant la mise en ligne. */

import crypto from 'node:crypto';
import {
  insererDossier, lireDossier, majDossier, listerDossiers, compterParStatut,
  lireTentatives, ecrireTentatives,
  urlTeleversementSignee, telechargerFichier, supprimerFichier, BUCKET_PREUVES
} from '../api/_lib/supabase.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définies.');
  process.exit(1);
}

let echecs = 0;
const etape = async (nom, fn) => {
  try {
    const detail = await fn();
    console.log('  ok    ' + nom + (detail ? '  → ' + detail : ''));
  } catch (e) {
    echecs++;
    console.log('  ÉCHEC ' + nom + '  → ' + (e && e.message ? e.message : e));
  }
};

const numero = 'PE-TEST-' + crypto.randomBytes(3).toString('hex').toUpperCase();
const chemin = 'test/' + crypto.randomUUID() + '.txt';
const contenu = Buffer.from('preuve de test — supprimée automatiquement');

console.log('\nVérification du projet Supabase\n');

await etape('table dossiers accessible', async () => {
  const n = await listerDossiers('all');
  return n.length + ' dossier(s) existant(s)';
});

await etape('création d\'un dossier de test', async () => {
  const cree = await insererDossier({
    numero, prenom: 'Test', nom: 'Vérification', email: 'test@exemple.invalid',
    telephone: '0600000000', ville: 'Test', adresse: 'Test', pays: 'France',
    naissance: '2000-01-01',
    permis_id: 'B', permis_nom: 'Permis B', montant: 800,
    moyen_id: 'vir', moyen_nom: 'Virement bancaire',
    statut: 'pending', historique: []
  });
  if (!cree) throw new Error('insertion refusée');
  return cree.numero;
});

await etape('relecture du dossier', async () => {
  const d = await lireDossier(numero);
  if (!d) throw new Error('dossier introuvable après insertion');
  return 'statut ' + d.statut;
});

await etape('mise à jour (décision)', async () => {
  const d = await majDossier(numero, {
    statut: 'approved', message: 'test', decide_le: new Date().toISOString()
  });
  if (d.statut !== 'approved') throw new Error('statut non mis à jour');
  return 'statut ' + d.statut;
});

await etape('comptage par statut', async () => {
  const t = await compterParStatut();
  return t.all + ' au total';
});

await etape('table admin_tentatives accessible', async () => {
  await ecrireTentatives({ ip: 'test-verif', echecs: 1, bloque_jusqu_a: null, maj_le: new Date().toISOString() });
  const t = await lireTentatives('test-verif');
  if (!t) throw new Error('écriture non relue');
  return 'écriture et relecture OK';
});

let urlDepot = null;
await etape('URL de téléversement signée', async () => {
  urlDepot = await urlTeleversementSignee(BUCKET_PREUVES, chemin);
  return urlDepot.split('?')[0].split('/storage/v1')[1];
});

await etape('dépôt du fichier via l\'URL signée', async () => {
  if (!urlDepot) throw new Error('pas d\'URL signée');
  const r = await fetch(urlDepot, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: contenu
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return contenu.length + ' octets';
});

await etape('lecture du fichier depuis le bucket privé', async () => {
  const f = await telechargerFichier(BUCKET_PREUVES, chemin);
  if (!f) throw new Error('fichier introuvable');
  if (f.octets.toString() !== contenu.toString()) throw new Error('contenu différent');
  return f.octets.length + ' octets relus';
});

/* --- Nettoyage : rien ne doit rester --- */
console.log('\nNettoyage\n');

await etape('suppression du fichier de test', async () => {
  await supprimerFichier(BUCKET_PREUVES, chemin);
  const f = await telechargerFichier(BUCKET_PREUVES, chemin);
  if (f) throw new Error('le fichier existe encore');
  return 'supprimé';
});

await etape('suppression du dossier de test', async () => {
  const base = String(process.env.SUPABASE_URL).replace(/\/+$/, '');
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(base + '/rest/v1/dossiers?numero=eq.' + encodeURIComponent(numero), {
    method: 'DELETE', headers: { apikey: cle, Authorization: 'Bearer ' + cle }
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  await fetch(base + '/rest/v1/admin_tentatives?ip=eq.test-verif', {
    method: 'DELETE', headers: { apikey: cle, Authorization: 'Bearer ' + cle }
  });
  return 'supprimé';
});

console.log('');
if (echecs) {
  console.log(echecs + ' vérification(s) en échec — voir ci-dessus.');
  process.exit(1);
}
console.log('Projet Supabase opérationnel.');
