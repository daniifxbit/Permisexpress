/* GET /api/admin/preuve?numero=PE-2026-123456[&telecharger=1]

   Sert le fichier de preuve. Le bucket est privé : le fichier n'a aucune URL
   publique et ne peut être obtenu que par cette route, derrière la session
   administrateur. La page l'utilise directement comme source d'un <img> ou
   d'un <iframe> — le cookie part avec la requête.

   Content-Disposition: inline permet au lecteur PDF intégré du navigateur de
   s'afficher ; avec ?telecharger=1 le fichier est proposé en enregistrement. */

import { exigeSession } from '../_lib/auth.js';
import { lireDossier, telechargerPreuve } from '../_lib/supabase.js';
import { json, methodes, texte, erreurServeur, configuré, nonConfiguré } from '../_lib/http.js';

/* Neutralise guillemets et retours à la ligne, qui permettraient d'injecter
   un en-tête supplémentaire via le nom de fichier fourni par le client. */
function nomSûr(nom) {
  return String(nom || 'preuve').replace(/[^\w .\-()]/g, '_').slice(0, 100);
}

export default async function handler(req, res) {
  if (!methodes(req, res, ['GET'])) return;
  if (!configuré()) return nonConfiguré(res);
  if (!exigeSession(req, res)) return;

  const numero = texte(req.query.numero, 40).toUpperCase();
  if (!numero) return json(res, 400, { erreur: 'Numéro de dossier manquant.' });

  try {
    const dossier = await lireDossier(numero);
    if (!dossier) return json(res, 404, { erreur: 'Dossier introuvable.' });
    if (!dossier.preuve_chemin) return json(res, 404, { erreur: 'Aucune preuve pour ce dossier.' });

    const fichier = await telechargerPreuve(dossier.preuve_chemin);
    if (!fichier) return json(res, 404, { erreur: 'Fichier introuvable dans le stockage.' });

    const disposition = req.query.telecharger ? 'attachment' : 'inline';
    res.setHeader('Content-Type', dossier.preuve_type || fichier.type);
    res.setHeader('Content-Disposition', disposition + '; filename="' + nomSûr(dossier.preuve_nom) + '"');
    res.setHeader('Content-Length', String(fichier.octets.length));
    res.setHeader('Cache-Control', 'private, no-store');
    // Le fichier vient d'un tiers : on empêche le navigateur de le réinterpréter.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(fichier.octets);
  } catch (e) {
    erreurServeur(res, 'admin/preuve', e);
  }
}
