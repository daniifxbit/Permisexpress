/* GET /api/admin/session — la session en cours est-elle valide ?

   Permet à la page de rouvrir l'espace administrateur sans redemander le code
   tant que le cookie est valable. */

import { sessionValide } from '../_lib/auth.js';
import { json, methodes } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!methodes(req, res, ['GET'])) return;
  let ouverte = false;
  try {
    ouverte = sessionValide(req);
  } catch {
    // SESSION_SECRET absent : on considère simplement qu'aucune session n'est ouverte.
    ouverte = false;
  }
  json(res, 200, { ouverte });
}
