/* GET /api/admin/preuve?numero=PE-2026-123456[&piece=photo][&telecharger=1]

   Sert une pièce du dossier : la preuve de paiement par défaut, la photo
   d'identité avec ?piece=photo. Les deux buckets sont privés : ces fichiers
   n'ont aucune URL publique et ne s'obtiennent que par cette route, derrière
   la session administrateur. La page les utilise directement comme source
   d'un <img> ou d'un <iframe> — le cookie part avec la requête.

   Content-Disposition: inline permet au lecteur PDF intégré du navigateur de
   s'afficher ; avec ?telecharger=1 le fichier est proposé en enregistrement. */

import { exigeSession } from '../_lib/auth.js';
import { lireDossier, telechargerFichier, BUCKET_PREUVES, BUCKET_PHOTOS }
  from '../_lib/supabase.js';
import { json, methodes, texte, erreurServeur, configuré, nonConfiguré } from '../_lib/http.js';

/* Neutralise guillemets et retours à la ligne, qui permettraient d'injecter
   un en-tête supplémentaire via le nom de fichier fourni par le client. */
function nomSûr(nom) {
  return String(nom || 'fichier').replace(/[^\w .\-()]/g, '_').slice(0, 100);
}

const PIECES = {
  preuve: {
    bucket: BUCKET_PREUVES,
    chemin: (d) => d.preuve_chemin,
    nom: (d) => d.preuve_nom,
    type: (d) => d.preuve_type,
    absente: 'Aucune preuve pour ce dossier.'
  },
  photo: {
    bucket: BUCKET_PHOTOS,
    chemin: (d) => d.photo_chemin,
    nom: (d) => d.photo_nom,
    type: (d) => d.photo_type,
    absente: 'Aucune photo pour ce dossier.'
  }
};

export default async function handler(req, res) {
  if (!methodes(req, res, ['GET'])) return;
  if (!configuré()) return nonConfiguré(res);
  if (!exigeSession(req, res)) return;

  const numero = texte(req.query.numero, 40).toUpperCase();
  if (!numero) return json(res, 400, { erreur: 'Numéro de dossier manquant.' });

  const piece = PIECES[texte(req.query.piece, 20)] || PIECES.preuve;

  try {
    const dossier = await lireDossier(numero);
    if (!dossier) return json(res, 404, { erreur: 'Dossier introuvable.' });

    const chemin = piece.chemin(dossier);
    if (!chemin) return json(res, 404, { erreur: piece.absente });

    const fichier = await telechargerFichier(piece.bucket, chemin);
    if (!fichier) return json(res, 404, { erreur: 'Fichier introuvable dans le stockage.' });

    const disposition = req.query.telecharger ? 'attachment' : 'inline';
    res.setHeader('Content-Type', piece.type(dossier) || fichier.type);
    res.setHeader('Content-Disposition',
      disposition + '; filename="' + nomSûr(piece.nom(dossier)) + '"');
    res.setHeader('Content-Length', String(fichier.octets.length));
    res.setHeader('Cache-Control', 'private, no-store');
    // Le fichier vient d'un tiers : on empêche le navigateur de le réinterpréter.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(fichier.octets);
  } catch (e) {
    erreurServeur(res, 'admin/preuve', e);
  }
}
