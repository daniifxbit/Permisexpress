/* POST /api/suivi — consultation de son dossier par le client.

   Exige le numéro ET l'adresse e-mail. Le numéro seul ne suffit pas : sans
   cela, quiconque essaierait des numéros au hasard lirait le nom, le montant
   et les coordonnées d'autres clients.

   La réponse est volontairement minimale — statut, formation, montant, moyen
   de paiement et message de l'équipe. Ni adresse, ni téléphone, ni preuve. */

import { lireDossier } from './_lib/supabase.js';
import { json, methodes, corps, texte, estEmail, erreurServeur, configuré, nonConfiguré } from './_lib/http.js';

export default async function handler(req, res) {
  if (!methodes(req, res, ['POST'])) return;
  if (!configuré()) return nonConfiguré(res);

  const d = corps(req);
  if (!d) return json(res, 400, { erreur: 'Requête illisible.' });

  const numero = texte(d.numero, 40).toUpperCase();
  const email = texte(d.email, 160).toLowerCase();

  if (!numero) return json(res, 400, { erreur: 'Saisissez votre numéro de dossier.' });
  if (!estEmail(email)) return json(res, 400, { erreur: 'Saisissez l\'adresse e-mail de votre demande.' });

  try {
    const dossier = await lireDossier(numero);

    // Même réponse dans les deux cas : rien ne révèle si le numéro existe.
    if (!dossier || String(dossier.email).toLowerCase() !== email) {
      return json(res, 404, { erreur: 'Aucun dossier ne correspond à ce numéro et à cette adresse e-mail.' });
    }

    json(res, 200, {
      numero: dossier.numero,
      date: dossier.cree_le,
      permis: dossier.permis_nom,
      montant: dossier.montant,
      moyen: dossier.moyen_nom,
      statut: dossier.statut,
      message: dossier.message || '',
      decide_le: dossier.decide_le || '',
      preuve_nom: dossier.preuve_nom || ''
    });
  } catch (e) {
    erreurServeur(res, 'suivi', e);
  }
}
