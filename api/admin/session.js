/* /api/admin/session
     GET    — une session administrateur est-elle ouverte ?
     DELETE — la fermer.

   Les deux tiennent dans une seule fonction : l'offre gratuite de Vercel en
   plafonne le nombre, et une déconnexion n'est qu'une opération sur cette
   même ressource. */

import { sessionValide, effacerCookie } from '../_lib/auth.js';
import { json, methodes } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!methodes(req, res, ['GET', 'DELETE'])) return;

  if (req.method === 'DELETE') {
    effacerCookie(res);
    return json(res, 200, { ouverte: false });
  }

  let ouverte = false;
  try {
    ouverte = sessionValide(req);
  } catch {
    // SESSION_SECRET absent : aucune session ne peut être valide.
    ouverte = false;
  }
  json(res, 200, { ouverte });
}
