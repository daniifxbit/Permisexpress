/* Génère l'empreinte scrypt du code d'accès administrateur.
   Usage : node scripts/generer-code-admin.mjs
   La valeur affichée est à coller dans la variable ADMIN_PASSWORD_HASH. */

import { empreinte } from '../api/_lib/auth.js';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = (await rl.question('Nouveau code d\'accès administrateur : ')).trim();
rl.close();

if (code.length < 12) {
  console.error('\nCode trop court : 12 caractères minimum.');
  process.exit(1);
}

console.log('\n--- À coller dans les variables d\'environnement Vercel ---\n');
console.log('ADMIN_PASSWORD_HASH=' + empreinte(code));
console.log('SESSION_SECRET=' + crypto.randomBytes(32).toString('base64url'));
console.log('\nLe code lui-même n\'est stocké nulle part : conservez-le de votre côté.');
