/* POST /api/admin/logout — ferme la session administrateur. */

import { effacerCookie } from '../_lib/auth.js';
import { json, methodes } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!methodes(req, res, ['POST'])) return;
  effacerCookie(res);
  json(res, 200, { ok: true });
}
