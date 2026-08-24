/* Contrôles de validité partagés par les fonctions serverless.

   Ces vérifications existent aussi côté navigateur, pour un retour immédiat.
   Le doublon est volontaire : le navigateur peut être contourné, c'est donc
   celles-ci qui font foi. */

/* Clé IBAN : les quatre premiers caractères passent à la fin, les lettres
   deviennent des nombres (A=10 … Z=35), le reste modulo 97 doit valoir 1.
   Détecte la quasi-totalité des fautes de frappe. */
export function ibanValide(valeur) {
  const n = String(valeur || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(n)) return false;
  const permute = n.slice(4) + n.slice(0, 4);
  let reste = 0;
  for (const c of permute) {
    const chiffres = /[0-9]/.test(c) ? c : String(c.charCodeAt(0) - 55);
    for (const d of chiffres) reste = (reste * 10 + Number(d)) % 97;
  }
  return reste === 1;
}

/* BIC : 4 lettres (banque), 2 lettres (pays), 2 caractères (localité),
   éventuellement 3 de plus pour l'agence. */
export function bicValide(valeur) {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(
    String(valeur || '').replace(/\s+/g, '').toUpperCase());
}

/* NEPH — numéro d'enregistrement préfectoral harmonisé : douze caractères,
   chiffres le plus souvent, parfois avec des lettres selon l'ancienneté du
   dossier. On reste tolérant sur la casse et les espaces de saisie. */
export function nephValide(valeur) {
  return /^[0-9A-Z]{12}$/.test(String(valeur || '').replace(/[\s-]/g, '').toUpperCase());
}

export function nephNormalise(valeur) {
  return String(valeur || '').replace(/[\s-]/g, '').toUpperCase();
}
