/* POST /api/dossiers — enregistre une demande, ou renvoie une preuve.

   Deux cas :
   - création : le client transmet ses informations, le serveur attribue le
     numéro de dossier et calcule le montant depuis le catalogue ;
   - renvoi de preuve : le client transmet numéro + e-mail ; le dossier repasse
     en attente, la décision précédente est archivée dans l'historique.

   Le serveur ne prétend jamais qu'un paiement a été encaissé : un dossier créé
   est simplement « en attente de vérification ». */

import { permisParId, moyenParId } from './_lib/catalogue.js';
import { insererDossier, majDossier, lireDossier, supprimerPreuve } from './_lib/supabase.js';
import { verifierPreuve } from './_lib/auth.js';
import { json, methodes, corps, texte, estEmail, erreurServeur, configuré, nonConfiguré } from './_lib/http.js';

/* Numéro à six chiffres : suffisamment large pour éviter les collisions, et
   de toute façon inexploitable seul — le suivi exige aussi l'e-mail. */
function numero() {
  return 'PE-' + new Date().getFullYear() + '-' +
    String(Math.floor(Math.random() * 900000) + 100000);
}

function valider(d) {
  const erreurs = {};
  const f = {
    prenom: texte(d.prenom, 80),
    nom: texte(d.nom, 80),
    naissance: texte(d.naissance, 10),
    email: texte(d.email, 160),
    telephone: texte(d.telephone, 40),
    ville: texte(d.ville, 100),
    adresse: texte(d.adresse, 200),
    pays: texte(d.pays, 80),
    situation: texte(d.situation, 120)
  };
  if (!f.prenom) erreurs.prenom = 'Le prénom est requis.';
  if (!f.nom) erreurs.nom = 'Le nom est requis.';
  if (!f.naissance || !/^\d{4}-\d{2}-\d{2}$/.test(f.naissance)) {
    erreurs.naissance = 'La date de naissance est requise.';
  }
  if (!estEmail(f.email)) erreurs.email = 'Adresse e-mail invalide.';
  if (f.telephone.replace(/[^0-9]/g, '').length < 8) erreurs.telephone = 'Numéro de téléphone invalide.';
  if (!f.ville) erreurs.ville = 'La ville est requise.';
  if (!f.adresse) erreurs.adresse = 'L\'adresse est requise.';
  if (!f.pays) erreurs.pays = 'Le pays de résidence est requis.';
  return { f, erreurs };
}

export default async function handler(req, res) {
  if (!methodes(req, res, ['POST'])) return;
  if (!configuré()) return nonConfiguré(res);

  const d = corps(req);
  if (!d) return json(res, 400, { erreur: 'Requête illisible.' });

  // La preuve est obligatoire dans les deux cas.
  const preuve = verifierPreuve(d.preuve);
  if (!preuve) {
    return json(res, 400, { erreur: 'Preuve de paiement manquante ou expirée. Joignez à nouveau le fichier.' });
  }

  const moyen = moyenParId(texte(d.moyen_id, 20));
  if (!moyen) return json(res, 400, { erreur: 'Moyen de paiement inconnu.' });


  try {
    /* ---------------- Renvoi d'une preuve sur un dossier existant --------- */
    if (d.numero) {
      const numeroDemande = texte(d.numero, 40).toUpperCase();
      const emailDemande = texte(d.email, 160).toLowerCase();
      const existant = await lireDossier(numeroDemande);

      // Réponse identique que le dossier soit introuvable ou que l'e-mail ne
      // corresponde pas : rien ne permet de deviner quels numéros existent.
      if (!existant || String(existant.email).toLowerCase() !== emailDemande) {
        return json(res, 404, { erreur: 'Aucun dossier ne correspond à ce numéro et à cette adresse e-mail.' });
      }

      const historique = Array.isArray(existant.historique) ? existant.historique.slice() : [];
      if (existant.decide_le) {
        historique.push({ statut: existant.statut, message: existant.message, le: existant.decide_le });
      }

      const ancienneP = existant.preuve_chemin;
      const maj = await majDossier(numeroDemande, {
        preuve_chemin: preuve.chemin,
        preuve_nom: preuve.nom,
        preuve_type: preuve.type,
        moyen_id: moyen.id,
        moyen_nom: moyen.nom,
        statut: 'pending',
        message: null,
        decide_le: null,
        renvoye_le: new Date().toISOString(),
        historique
      });

      // L'ancienne preuve n'a plus d'usage : on ne conserve pas de données
      // personnelles au-delà du nécessaire.
      if (ancienneP && ancienneP !== preuve.chemin) {
        try { await supprimerPreuve(ancienneP); } catch (e) { console.error('[purge preuve]', e); }
      }

      return json(res, 200, {
        numero: maj.numero,
        date: maj.cree_le,
        permis: maj.permis_nom,
        montant: maj.montant,
        moyen: maj.moyen_nom,
        statut: maj.statut
      });
    }

    /* ---------------- Création d'un dossier ------------------------------- */
    const permis = permisParId(texte(d.permis_id, 20));
    if (!permis) return json(res, 400, { erreur: 'Formation inconnue.' });

    const { f, erreurs } = valider(d);
    if (Object.keys(erreurs).length) {
      return json(res, 422, { erreur: 'Certaines informations sont incomplètes.', champs: erreurs });
    }

    const ligne = {
      prenom: f.prenom, nom: f.nom, naissance: f.naissance, email: f.email,
      telephone: f.telephone, ville: f.ville, adresse: f.adresse, pays: f.pays,
      situation: f.situation || null,
      permis_id: permis.id, permis_nom: permis.nom, montant: permis.prix,
      moyen_id: moyen.id, moyen_nom: moyen.nom,
      preuve_chemin: preuve.chemin, preuve_nom: preuve.nom, preuve_type: preuve.type,
      statut: 'pending', historique: []
    };

    // Le numéro est tiré au hasard : en cas de collision (contrainte unique),
    // on retente avec un autre.
    let cree = null;
    for (let essai = 0; essai < 5 && !cree; essai++) {
      cree = await insererDossier(Object.assign({ numero: numero() }, ligne));
    }
    if (!cree) return json(res, 503, { erreur: 'Enregistrement impossible. Réessayez dans un instant.' });

    json(res, 201, {
      numero: cree.numero,
      date: cree.cree_le,
      permis: cree.permis_nom,
      montant: cree.montant,
      moyen: cree.moyen_nom,
      statut: cree.statut
    });
  } catch (e) {
    erreurServeur(res, 'dossiers', e);
  }
}
