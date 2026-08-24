/* GET /api/catalogue — formations, moyens de paiement et coordonnées bancaires.

   Le navigateur s'en sert pour construire l'étape 1 du parcours et le panneau
   de virement. Les coordonnées y sont jointes plutôt que servies par une
   fonction dédiée : l'offre gratuite de Vercel plafonne leur nombre.

   Si l'appel échoue, app.js retombe sur les tarifs présents en HTML dans la
   page et n'affiche aucune coordonnée bancaire — mieux vaut renvoyer le client
   vers le téléphone que lui montrer un IBAN dont on ignore s'il est à jour. */

import { PERMIS, MOYENS } from './_lib/catalogue.js';
import { lireBanque } from './_lib/parametres.js';
import { methodes, erreurServeur } from './_lib/http.js';

export default async function handler(req, res) {
  if (!methodes(req, res, ['GET'])) return;
  try {
    const banque = await lireBanque();
    // Aucune mise en cache : une modification des coordonnées bancaires depuis
    // l'espace administrateur doit prendre effet immédiatement. Un IBAN périmé
    // servi ne serait-ce qu'une minute enverrait de l'argent au mauvais endroit.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify({ permis: PERMIS, moyens: MOYENS, banque }));
  } catch (e) {
    erreurServeur(res, 'catalogue', e);
  }
}
