/* POST /api/admin/decision — valide ou rejette une preuve de paiement.

   Règles reprises telles quelles du parcours métier :
   - le message est obligatoire pour rejeter, facultatif pour valider ;
   - un dossier déjà tranché est verrouillé jusqu'à ce que le client renvoie
     une nouvelle preuve — la règle est appliquée ici, côté serveur, et non
     seulement par l'affichage. */

import { exigeSession } from '../_lib/auth.js';
import { lireDossier, majDossier } from '../_lib/supabase.js';
import { json, methodes, corps, texte, erreurServeur, configuré, nonConfiguré } from '../_lib/http.js';

const PAR_DEFAUT = {
  approved: 'Votre paiement a été vérifié et validé. Un conseiller vous contacte pour planifier votre formation.',
  rejected: 'Votre preuve de paiement n\'a pas pu être validée.'
};

export default async function handler(req, res) {
  if (!methodes(req, res, ['POST'])) return;
  if (!configuré()) return nonConfiguré(res);
  if (!exigeSession(req, res)) return;

  const d = corps(req);
  if (!d) return json(res, 400, { erreur: 'Requête illisible.' });

  const numero = texte(d.numero, 40).toUpperCase();
  const statut = texte(d.statut, 20);
  const message = texte(d.message, 2000);

  if (!numero) return json(res, 400, { erreur: 'Numéro de dossier manquant.' });
  if (!['approved', 'rejected'].includes(statut)) return json(res, 400, { erreur: 'Décision inconnue.' });
  if (statut === 'rejected' && !message) {
    return json(res, 422, { erreur: 'Indiquez la raison du rejet avant de rejeter.' });
  }

  try {
    const dossier = await lireDossier(numero);
    if (!dossier) return json(res, 404, { erreur: 'Dossier introuvable.' });
    if (dossier.statut !== 'pending') {
      return json(res, 409, {
        erreur: 'Ce dossier a déjà été traité. Il attend une nouvelle preuve du client.'
      });
    }

    const maj = await majDossier(numero, {
      statut,
      message: message || PAR_DEFAUT[statut],
      decide_le: new Date().toISOString(),
      renvoye_le: null
    });

    /* Point d'intégration e-mail : c'est ici qu'un envoi au client prendra
       place (confirmation de validation, ou motif du rejet). Tant qu'aucun
       service n'est branché, le client est informé via « Suivre ma demande ».
       Voir README.md § « Aller plus loin ». */

    json(res, 200, {
      numero: maj.numero,
      statut: maj.statut,
      message: maj.message,
      decide_le: maj.decide_le
    });
  } catch (e) {
    erreurServeur(res, 'admin/decision', e);
  }
}
