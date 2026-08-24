/* ===========================================================================
   COORDONNÉES BANCAIRES — le seul fichier à modifier pour changer le compte
   qui reçoit les virements.

   Modifiez uniquement ce qui se trouve entre les guillemets. Ne touchez ni aux
   guillemets, ni aux virgules, ni aux accolades { }.

   Après enregistrement, le site se met à jour tout seul en une minute environ.

   L'IBAN est vérifié automatiquement au chargement de la page. S'il comporte
   une faute de frappe, le site n'affiche AUCUNE coordonnée et invite le client
   à vous appeler : mieux vaut un paiement retardé qu'un virement envoyé sur un
   compte inexistant.

   Marche à suivre détaillée : voir README.md, section « Changer les
   coordonnées bancaires ».
   =========================================================================== */

window.COORDONNEES_BANCAIRES = {

  // Nom du titulaire du compte, tel qu'il apparaît sur le relevé bancaire.
  titulaire: 'DIDIER LEON DELABY',

  // IBAN. Les espaces sont conservés pour la lisibilité ; le bouton
  // « Copier » les retire automatiquement.
  iban: 'FR76 1723 8000 0100 4567 8420 305',

  // BIC, aussi appelé code SWIFT. 8 ou 11 caractères.
  bic: 'SCSYFRP2',

  // RIB, sous la forme : code banque, code guichet, numéro de compte, clé.
  // Il figure sur le même relevé que l'IBAN. Laissez '' pour ne pas l'afficher.
  rib: '17238 00001 00456784203 05',

  // Référence que le client reporte sur son virement.
  reference: 'PE-Paiement complet service'

};
