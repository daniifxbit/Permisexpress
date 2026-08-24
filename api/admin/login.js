/* POST /api/admin/login — ouverture d'une session administrateur.

   Le code n'est jamais comparé côté navigateur et n'apparaît nulle part dans
   le code de la page : seule son empreinte scrypt existe, en variable
   d'environnement. En cas de succès, un cookie de session signé, HttpOnly, est
   posé pour huit heures.

   L'URL étant publique, elle sera scannée : les tentatives sont comptées par
   adresse IP et bloquées quinze minutes au bout de dix échecs. */

import { codeValide, poserCookie } from '../_lib/auth.js';
import { lireTentatives, ecrireTentatives } from '../_lib/supabase.js';
import { json, methodes, corps, ip, erreurServeur, configuré, nonConfiguré } from '../_lib/http.js';

const MAX_ECHECS = 10;
const BLOCAGE = 15 * 60 * 1000;

export default async function handler(req, res) {
  if (!methodes(req, res, ['POST'])) return;
  if (!configuré()) return nonConfiguré(res);

  if (!process.env.ADMIN_PASSWORD_HASH || !process.env.SESSION_SECRET) {
    return json(res, 503, {
      erreur: 'L\'espace administrateur n\'est pas configuré.',
      detail: 'Variables ADMIN_PASSWORD_HASH et SESSION_SECRET absentes — voir README.md.'
    });
  }

  const d = corps(req);
  if (!d) return json(res, 400, { erreur: 'Requête illisible.' });

  const adresse = ip(req);

  try {
    const tentatives = await lireTentatives(adresse);
    if (tentatives && tentatives.bloque_jusqu_a && new Date(tentatives.bloque_jusqu_a) > new Date()) {
      const minutes = Math.ceil((new Date(tentatives.bloque_jusqu_a) - Date.now()) / 60000);
      return json(res, 429, {
        erreur: 'Trop de tentatives. Réessayez dans ' + minutes + ' minute' + (minutes > 1 ? 's' : '') + '.'
      });
    }

    // scrypt prend déjà quelques dizaines de millisecondes, ce qui limite
    // naturellement la cadence d'un essai exhaustif.
    const ok = typeof d.code === 'string' && d.code.length > 0 && codeValide(d.code);

    if (!ok) {
      const echecs = (tentatives ? tentatives.echecs : 0) + 1;
      await ecrireTentatives({
        ip: adresse,
        echecs,
        bloque_jusqu_a: echecs >= MAX_ECHECS ? new Date(Date.now() + BLOCAGE).toISOString() : null,
        maj_le: new Date().toISOString()
      });
      return json(res, 401, { erreur: 'Code d\'accès incorrect.' });
    }

    await ecrireTentatives({ ip: adresse, echecs: 0, bloque_jusqu_a: null, maj_le: new Date().toISOString() });
    poserCookie(res);
    json(res, 200, { ok: true });
  } catch (e) {
    erreurServeur(res, 'admin/login', e);
  }
}
