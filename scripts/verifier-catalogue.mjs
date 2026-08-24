/* Compare les tarifs affichés en HTML statique (index.html, pour le
   référencement) avec le catalogue serveur, qui fait foi.

   Usage : node scripts/verifier-catalogue.mjs */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMIS } from '../api/_lib/catalogue.js';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(racine, 'index.html'), 'utf8');

const cartes = [...html.matchAll(/data-permit="([^"]+)"\s+data-price="(\d+)"/g)]
  .map(m => ({ id: m[1], prix: Number(m[2]) }));

let ecarts = 0;

for (const carte of cartes) {
  const reference = PERMIS.find(p => p.id === carte.id);
  if (!reference) {
    ecarts++;
    console.log('  ÉCART  « ' + carte.id +' » figure dans index.html mais pas dans le catalogue serveur.');
  } else if (reference.prix !== carte.prix) {
    ecarts++;
    console.log('  ÉCART  « ' + carte.id + ' » : ' + carte.prix + ' € dans index.html, ' +
      reference.prix + ' € côté serveur.');
  } else {
    console.log('  ok     ' + carte.id.padEnd(5) + reference.prix + ' €');
  }
}

for (const p of PERMIS) {
  if (!cartes.some(c => c.id === p.id)) {
    ecarts++;
    console.log('  ÉCART  « ' + p.id + ' » est au catalogue mais absent de la section Tarifs.');
  }
}

console.log('');
if (ecarts) {
  console.log(ecarts + ' écart(s). Le catalogue serveur (api/_lib/catalogue.js) fait foi.');
  process.exit(1);
}
console.log(cartes.length + ' tarifs cohérents entre index.html et le catalogue serveur.');
