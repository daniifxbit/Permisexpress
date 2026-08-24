/* GET /api/catalogue — formations et moyens de paiement.

   Le navigateur s'en sert pour construire l'étape 1 du parcours. Si l'appel
   échoue, app.js retombe sur les tarifs présents en HTML dans la page. */

import { PERMIS, MOYENS } from './_lib/catalogue.js';
import { methodes } from './_lib/http.js';

export default async function handler(req, res) {
  if (!methodes(req, res, ['GET'])) return;
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).send(JSON.stringify({ permis: PERMIS, moyens: MOYENS }));
}
