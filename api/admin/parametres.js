/* /api/admin/parametres
     GET  — lire les réglages modifiables (coordonnées bancaires)
     POST — les enregistrer

   Session administrateur obligatoire dans les deux sens : les coordonnées
   sont publiques une fois affichées, mais qui peut les changer peut détourner
   les virements de tous les futurs clients.

   L'IBAN est revalidé ici, quoi qu'ait affiché le navigateur : c'est ce
   contrôle-ci qui fait foi. */

import { exigeSession } from '../_lib/auth.js';
import { lireBanque, validerBanque, enregistrerBanque } from '../_lib/parametres.js';
import { json, methodes, corps, erreurServeur, configuré, nonConfiguré } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!methodes(req, res, ['GET', 'POST'])) return;
  if (!configuré()) return nonConfiguré(res);
  if (!exigeSession(req, res)) return;

  try {
    if (req.method === 'GET') {
      return json(res, 200, { banque: await lireBanque() });
    }

    const d = corps(req);
    if (!d || !d.banque) return json(res, 400, { erreur: 'Requête illisible.' });

    const resultat = validerBanque(d.banque);
    if (resultat.erreurs) {
      return json(res, 422, {
        erreur: 'Certaines coordonnées sont incorrectes.',
        champs: resultat.erreurs
      });
    }

    await enregistrerBanque(resultat.banque);
    json(res, 200, { banque: resultat.banque, enregistre: true });
  } catch (e) {
    erreurServeur(res, 'admin/parametres', e);
  }
}
