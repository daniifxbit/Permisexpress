/* Paramètres modifiables depuis l'espace administrateur.

   Ils vivent en base, dans la table `parametres`, pour être changés sans
   toucher au code ni redéployer. Tant qu'aucune valeur n'a été enregistrée,
   les valeurs par défaut ci-dessous s'appliquent : le site fonctionne dès le
   premier déploiement, sans écran de configuration obligatoire. */

import { lireParametre, ecrireParametre } from './supabase.js';
import { ibanValide, bicValide } from './validation.js';

const CLE_BANQUE = 'banque';

/* Compte communiqué le 24/08/2026. Sert de valeur initiale ; toute
   modification depuis l'espace administrateur prend le pas sur celle-ci. */
const BANQUE_PAR_DEFAUT = {
  titulaire: 'DIDIER LEON DELABY',
  iban: 'FR76 1723 8000 0100 4567 8420 305',
  bic: 'SCSYFRP2',
  rib: '17238 00001 00456784203 05',
  reference: 'PE-Paiement complet service'
};

export async function lireBanque() {
  let enregistre = null;
  try {
    enregistre = await lireParametre(CLE_BANQUE);
  } catch (e) {
    // Base injoignable : on sert la valeur par défaut plutôt que rien.
    console.error('[parametres]', e);
  }
  return Object.assign({}, BANQUE_PAR_DEFAUT, enregistre || {});
}

/* Renvoie { banque } si tout est valide, { erreurs } sinon. Le titulaire et
   l'IBAN sont indispensables : sans eux, aucun virement n'aboutit. */
export function validerBanque(donnees) {
  const propre = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const banque = {
    titulaire: propre(donnees.titulaire, 140),
    iban: propre(donnees.iban, 40).toUpperCase(),
    bic: propre(donnees.bic, 20).toUpperCase(),
    rib: propre(donnees.rib, 60),
    reference: propre(donnees.reference, 80)
  };

  const erreurs = {};
  if (!banque.titulaire) erreurs.titulaire = 'Le nom du titulaire est requis.';
  if (!banque.iban) erreurs.iban = 'L\'IBAN est requis.';
  else if (!ibanValide(banque.iban)) {
    erreurs.iban = 'Cet IBAN est incorrect : sa clé de contrôle ne correspond pas. Vérifiez la saisie.';
  }
  if (banque.bic && !bicValide(banque.bic)) {
    erreurs.bic = 'Ce BIC est incorrect. Il compte 8 ou 11 caractères, sans espace.';
  }
  if (!banque.reference) erreurs.reference = 'La référence à indiquer est requise.';

  return Object.keys(erreurs).length ? { erreurs } : { banque };
}

export function enregistrerBanque(banque) {
  return ecrireParametre(CLE_BANQUE, banque);
}
