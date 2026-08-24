/* Catalogue des formations — source de vérité des prix.

   Le serveur ne fait jamais confiance au montant envoyé par le navigateur :
   le client transmet un identifiant de permis, le serveur en déduit le nom et
   le prix. Modifier un tarif se fait ici, et uniquement ici.

   La section Tarifs de index.html répète ces valeurs en HTML statique, pour le
   référencement et pour rester lisible si le JavaScript ne s'exécute pas.
   `node scripts/verifier-catalogue.mjs` compare les deux et signale tout écart. */

export const PERMIS = [
  { id: 'B',    cat: 'Voiture',     nom: 'Permis B',         desc: 'Le permis voiture classique.',              prix: 800 },
  { id: 'FULL', cat: 'Voiture',     nom: 'Permis complet',   desc: 'Code de la route + permis B, tout inclus.', prix: 1000 },
  { id: 'A1',   cat: 'Moto',        nom: 'Permis A1',        desc: 'Motos légères jusqu\'à 125 cm³.',           prix: 500 },
  { id: 'A2',   cat: 'Moto',        nom: 'Permis A2',        desc: 'Motos de puissance intermédiaire.',         prix: 650 },
  { id: 'C',    cat: 'Poids lourd', nom: 'Permis C',         desc: 'Véhicules de transport de marchandises.',   prix: 1300 },
  { id: 'D',    cat: 'Transport',   nom: 'Permis D',         desc: 'Transport de personnes (bus, autocar).',    prix: 2000 },
  { id: 'BE',   cat: 'Remorque',    nom: 'Permis BE',        desc: 'Voiture avec remorque lourde.',             prix: 500 },
  { id: 'CODE', cat: 'Théorie',     nom: 'Code de la route', desc: 'Préparation et passage du code seul.',      prix: 250 }
];

export const MOYENS = [
  { id: 'vir',  nom: 'Virement bancaire' },
  { id: 'wero', nom: 'Wero' },
  { id: 'wu',   nom: 'Western Union' }
];

export function permisParId(id) {
  return PERMIS.find(p => p.id === id) || null;
}

export function moyenParId(id) {
  return MOYENS.find(m => m.id === id) || null;
}
