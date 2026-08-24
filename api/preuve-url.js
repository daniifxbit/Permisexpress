/* POST /api/preuve-url — prépare le dépôt d'une preuve de paiement.

   Renvoie une URL de téléversement signée, à usage unique, ainsi qu'un jeton
   scellé décrivant le fichier. Le navigateur dépose le fichier directement sur
   le stockage, puis renvoie ce jeton avec le dossier.

   Le chemin est choisi ici, jamais par le client : impossible d'écraser le
   fichier d'un autre dossier ou d'écrire ailleurs dans le bucket. */

import crypto from 'node:crypto';
import { urlTeleversementSignee } from './_lib/supabase.js';
import { signerPreuve } from './_lib/auth.js';
import { json, methodes, corps, texte, erreurServeur, configuré, nonConfiguré } from './_lib/http.js';

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const TAILLE_MAX = 10 * 1024 * 1024;

export default async function handler(req, res) {
  if (!methodes(req, res, ['POST'])) return;
  if (!configuré()) return nonConfiguré(res);

  const donnees = corps(req);
  if (!donnees) return json(res, 400, { erreur: 'Requête illisible.' });

  const nom = texte(donnees.nom, 160);
  const type = texte(donnees.type, 100);
  const taille = Number(donnees.taille);

  if (!nom) return json(res, 400, { erreur: 'Nom de fichier manquant.' });
  if (!TYPES.includes(type)) {
    return json(res, 400, { erreur: 'Format non accepté. Envoyez une image (JPEG, PNG, WEBP, HEIC) ou un PDF.' });
  }
  if (!Number.isFinite(taille) || taille <= 0 || taille > TAILLE_MAX) {
    return json(res, 400, { erreur: 'Fichier trop volumineux : 10 Mo maximum.' });
  }

  try {
    // Extension conservée pour la lisibilité ; le nom d'origine n'entre jamais
    // dans le chemin, pour éviter tout caractère problématique.
    const extension = (nom.match(/\.[a-zA-Z0-9]{1,8}$/) || [''])[0].toLowerCase();
    const chemin = new Date().getUTCFullYear() + '/' + crypto.randomUUID() + extension;

    const url = await urlTeleversementSignee(chemin);
    const jeton = signerPreuve({ chemin, nom, type });

    json(res, 200, { url, jeton, type });
  } catch (e) {
    erreurServeur(res, 'preuve-url', e);
  }
}
