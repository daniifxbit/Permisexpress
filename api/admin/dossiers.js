/* GET /api/admin/dossiers?statut=all|pending|approved|rejected
   Liste les demandes. Session administrateur obligatoire.

   Contrairement à /api/suivi, cette réponse contient les coordonnées complètes
   du client : c'est précisément ce que l'administrateur doit vérifier. Le
   fichier de preuve, lui, n'est pas inclus — il se récupère à la demande via
   /api/admin/preuve, ce qui évite de transporter plusieurs mégaoctets par
   dossier à chaque ouverture de la liste. */

import { exigeSession } from '../_lib/auth.js';
import { listerDossiers, compterParStatut } from '../_lib/supabase.js';
import { json, methodes, erreurServeur, configuré, nonConfiguré } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!methodes(req, res, ['GET'])) return;
  if (!configuré()) return nonConfiguré(res);
  if (!exigeSession(req, res)) return;

  const statut = String(req.query.statut || 'all');
  if (!['all', 'pending', 'approved', 'rejected'].includes(statut)) {
    return json(res, 400, { erreur: 'Filtre inconnu.' });
  }

  try {
    const [lignes, totaux] = await Promise.all([listerDossiers(statut), compterParStatut()]);

    json(res, 200, {
      totaux,
      dossiers: lignes.map(d => ({
        numero: d.numero,
        date: d.cree_le,
        client: (d.prenom + ' ' + d.nom).trim(),
        email: d.email,
        telephone: d.telephone,
        adresse: [d.adresse, d.ville, d.pays].filter(Boolean).join(', '),
        naissance: d.naissance,
        situation: d.situation,
        permis: d.permis_nom,
        montant: d.montant,
        moyen: d.moyen_nom,
        reference_wu: d.reference_wu,
        preuve_nom: d.preuve_nom,
        preuve_type: d.preuve_type,
        a_preuve: Boolean(d.preuve_chemin),
        statut: d.statut,
        message: d.message || '',
        decide_le: d.decide_le || '',
        renvoye_le: d.renvoye_le || '',
        historique: Array.isArray(d.historique) ? d.historique : []
      }))
    });
  } catch (e) {
    erreurServeur(res, 'admin/dossiers', e);
  }
}
