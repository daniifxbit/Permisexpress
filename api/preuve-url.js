/* POST /api/preuve-url — prépare le dépôt d'un fichier par le client.

   Sert pour les deux pièces demandées : la preuve de paiement et la photo
   d'identité. Le champ `usage` désigne laquelle ; chacune a son bucket, ses
   formats et sa taille limite.

   Renvoie une URL de téléversement signée, à usage unique, ainsi qu'un jeton
   scellé décrivant le fichier. Le navigateur dépose le fichier directement sur
   le stockage, puis renvoie ce jeton avec le dossier.

   Le chemin est choisi ici, jamais par le client : impossible d'écraser le
   fichier d'un autre dossier ou d'écrire ailleurs dans le bucket. */

import crypto from 'node:crypto';
import { urlTeleversementSignee, BUCKET_PREUVES, BUCKET_PHOTOS } from './_lib/supabase.js';
import { signerPreuve } from './_lib/auth.js';
import { json, methodes, corps, texte, erreurServeur, configuré, nonConfiguré } from './_lib/http.js';

const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const USAGES = {
  preuve: {
    bucket: BUCKET_PREUVES,
    types: IMAGES.concat(['application/pdf']),
    tailleMax: 10 * 1024 * 1024,
    refusFormat: 'Format non accepté. Envoyez une image (JPEG, PNG, WEBP, HEIC) ou un PDF.',
    refusTaille: 'Fichier trop volumineux : 10 Mo maximum.'
  },
  photo: {
    bucket: BUCKET_PHOTOS,
    types: IMAGES,
    tailleMax: 5 * 1024 * 1024,
    refusFormat: 'La photo doit être une image (JPEG, PNG, WEBP ou HEIC).',
    refusTaille: 'Photo trop volumineuse : 5 Mo maximum.'
  }
};

export default async function handler(req, res) {
  if (!methodes(req, res, ['POST'])) return;
  if (!configuré()) return nonConfiguré(res);

  const donnees = corps(req);
  if (!donnees) return json(res, 400, { erreur: 'Requête illisible.' });

  // Sans précision, c'est une preuve de paiement : le comportement d'origine.
  const usage = USAGES[texte(donnees.usage, 20)] || USAGES.preuve;

  const nom = texte(donnees.nom, 160);
  const type = texte(donnees.type, 100);
  const taille = Number(donnees.taille);

  if (!nom) return json(res, 400, { erreur: 'Nom de fichier manquant.' });
  if (!usage.types.includes(type)) return json(res, 400, { erreur: usage.refusFormat });
  if (!Number.isFinite(taille) || taille <= 0 || taille > usage.tailleMax) {
    return json(res, 400, { erreur: usage.refusTaille });
  }

  try {
    // Extension conservée pour la lisibilité ; le nom d'origine n'entre jamais
    // dans le chemin, pour éviter tout caractère problématique.
    const extension = (nom.match(/\.[a-zA-Z0-9]{1,8}$/) || [''])[0].toLowerCase();
    const chemin = new Date().getUTCFullYear() + '/' + crypto.randomUUID() + extension;

    const url = await urlTeleversementSignee(usage.bucket, chemin);
    // Le bucket est scellé dans le jeton : le client ne peut pas faire passer
    // une photo pour une preuve, ni l'inverse.
    const jeton = signerPreuve({ chemin, nom, type, bucket: usage.bucket });

    json(res, 200, { url, jeton, type });
  } catch (e) {
    erreurServeur(res, 'preuve-url', e);
  }
}
