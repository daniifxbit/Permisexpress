/* ==========================================================================
   Permis Express — logique du site
   Parcours : permis → informations → récapitulatif → paiement → confirmation,
   plus le suivi de dossier client et l'espace administrateur.

   Les dossiers et les preuves de paiement vivent côté serveur (voir api/).
   Cette page ne conserve aucune donnée client : rien n'est écrit dans le
   navigateur, et le code d'accès administrateur n'apparaît nulle part ici.

   Aucune dépendance, aucune étape de build.
   ========================================================================== */

(function () {
  'use strict';

  /* ========================================================================
     1. CONFIGURATION — le seul endroit à modifier pour la mise en ligne
     ======================================================================== */

  var SITE = {
    /* Affichage */
    promoBar: true,
    gallery: false, // passer à true une fois de vraies photos ajoutées

    /* Coordonnées bancaires (virement).
       Clé IBAN et clé RIB vérifiées ; le RIB correspond bien à l'IBAN. */
    bank: {
      holder: 'DIDIER LEON DELABY',
      iban: 'FR76 1723 8000 0100 4567 8420 305',
      bic: 'SCSYFRP2',
      rib: '17238 00001 00456784203 05',
      complete: true
    },

    /* Contact affiché sur la facture */
    contact: {
      phone: '+33 6 76 32 61 99'
    },

    /* Mentions légales de la facture — À COMPLÉTER.
       SIRET et numéro de TVA portent chacun une clé de contrôle, vérifiée au
       chargement : tant qu'ils ne sont pas valides, la facture n'affiche aucun
       identifiant et conserve la mention « à compléter ». Une facture ne peut
       donc pas partir avec un numéro inexact.

       Les valeurs communiquées le 24/08/2026 — SIRET 812 345 678 00019,
       TVA FR 32 812345678, 12 rue de la Paix 75002 Paris — ne passent pas ce
       contrôle (clé de Luhn fausse ; clé TVA attendue 25). Elles n'ont donc
       pas été retenues. */
    company: {
      siret: '',
      tva: '',
      adresse: ''
    }

    /* Le code d'accès administrateur n'est plus ici : il est vérifié par
       /api/admin/login, à partir de son empreinte scrypt stockée en variable
       d'environnement. Voir README.md § « Espace administrateur ». */
  };

  var TAILLE_PREUVE_MAX = 10 * 1024 * 1024; // 10 Mo, aligné sur l'API

  /* ========================================================================
     2. CATALOGUE
     Chargé depuis /api/catalogue, qui fait foi pour les prix. Si l'appel
     échoue, on retombe sur les tarifs présents en HTML dans la page : le
     parcours reste utilisable même API indisponible.
     ======================================================================== */

  var PERMITS = [];
  var METHODS = [];

  function catalogueDepuisDom() {
    return $$('#tarifsGrid .card-tarif[data-permit]').map(function (carte) {
      return {
        id: carte.getAttribute('data-permit'),
        cat: (($('.card-tarif__cat', carte) || {}).textContent || '').trim(),
        name: (($('.card-tarif__name', carte) || {}).textContent || '').trim(),
        desc: (($('.card-tarif__desc', carte) || {}).textContent || '').trim(),
        price: Number(carte.getAttribute('data-price')) || 0
      };
    });
  }

  function moyensDepuisDom() {
    return $$('[data-action="pick-method"]').map(function (btn) {
      return {
        id: btn.getAttribute('data-method'),
        name: (($('.pick__name', btn) || {}).textContent || '').trim()
      };
    });
  }

  function chargerCatalogue() {
    return api('/api/catalogue', { method: 'GET' }).then(function (d) {
      PERMITS = d.permis.map(function (p) {
        return { id: p.id, cat: p.cat, name: p.nom, desc: p.desc, price: p.prix };
      });
      METHODS = d.moyens.map(function (m) { return { id: m.id, name: m.nom }; });
    }).catch(function () {
      PERMITS = catalogueDepuisDom();
      METHODS = moyensDepuisDom();
    });
  }

  var STATUS = {
    pending:  { label: 'En attente de vérification', cls: 'pending' },
    approved: { label: 'Paiement validé',            cls: 'approved' },
    rejected: { label: 'Preuve rejetée',             cls: 'rejected' }
  };

  /* ========================================================================
     3. ÉTAT
     ======================================================================== */

  var state = {
    step: 1,
    permit: null,          // id de PERMITS
    method: null,          // id de METHODS
    declared: false,       // le client a déclaré avoir effectué le paiement
    proof: { file: null, name: '' },
    envoiEnCours: false,

    // Renseignés par le serveur à la confirmation
    dossier: '',
    dossierDate: '',
    dossierMontant: null,
    dossierEmail: '',      // sert à authentifier un renvoi de preuve

    // Administration
    records: [],
    totaux: { all: 0, pending: 0, approved: 0, rejected: 0 },
    adminAuth: false,
    adminChargement: false,
    adminFilter: 'all',
    adminMsg: {},          // numéro -> message en cours de saisie

    trackFound: null
  };

  var form = {
    prenom: '', nom: '', naissance: '', tel: '', email: '',
    ville: '', adresse: '', pays: 'France', situation: ''
  };

  /* ========================================================================
     4. Utilitaires DOM
     ======================================================================== */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  /* Met à jour tous les [data-bind="clé"] de la page. */
  function setBind(key, value) {
    $$('[data-bind="' + key + '"]').forEach(function (node) { node.textContent = value; });
  }

  function euros(n) { return n + ' €'; }

  /* « 1995-11-03 » (valeur d'un input[type=date]) → « 03/11/1995 ». */
  function frDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '');
  }

  /* Horodatage ISO renvoyé par l'API → date lisible. */
  function frJour(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function frDateHeure(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleString('fr-FR');
  }

  /* Clé de Luhn : un chiffre sur deux doublé en partant de la droite, la
     somme doit être un multiple de 10. Vaut pour le SIREN et le SIRET. */
  function luhnValide(chiffres) {
    if (!/^\d+$/.test(chiffres)) return false;
    var somme = 0;
    for (var i = 0; i < chiffres.length; i++) {
      var c = Number(chiffres.charAt(chiffres.length - 1 - i));
      if (i % 2 === 1) { c *= 2; if (c > 9) c -= 9; }
      somme += c;
    }
    return somme % 10 === 0;
  }

  function siretValide(valeur) {
    var n = String(valeur || '').replace(/\s+/g, '');
    return n.length === 14 && luhnValide(n) && luhnValide(n.slice(0, 9));
  }

  /* TVA intracommunautaire française : clé = (12 + 3 × (SIREN mod 97)) mod 97. */
  function tvaValide(valeur, siret) {
    var n = String(valeur || '').replace(/\s+/g, '').toUpperCase();
    if (!/^FR[0-9A-Z]{2}\d{9}$/.test(n)) return false;
    var siren = n.slice(4);
    // Le numéro de TVA doit porter le SIREN de l'entreprise.
    if (siret && siren !== String(siret).replace(/\s+/g, '').slice(0, 9)) return false;
    var attendue = String((12 + 3 * (Number(siren) % 97)) % 97);
    if (attendue.length < 2) attendue = '0' + attendue;
    return n.slice(2, 4) === attendue;
  }

  /* Les mentions ne sont imprimées que si tout est cohérent : un identifiant
     inexact sur une facture vaut mieux absent que faux. */
  function mentionsLegales() {
    var c = SITE.company;
    if (!c.adresse || !siretValide(c.siret) || !tvaValide(c.tva, c.siret)) return null;
    return {
      adresse: c.adresse,
      ligne: 'SIRET ' + c.siret + ' · TVA ' + c.tva + ' · ' + c.adresse
    };
  }

  function permitById(id) {
    for (var i = 0; i < PERMITS.length; i++) if (PERMITS[i].id === id) return PERMITS[i];
    return null;
  }

  function permitByName(name) {
    for (var i = 0; i < PERMITS.length; i++) if (PERMITS[i].name === name) return PERMITS[i];
    return null;
  }

  function methodById(id) {
    for (var i = 0; i < METHODS.length; i++) if (METHODS[i].id === id) return METHODS[i];
    return null;
  }

  function methodByName(name) {
    for (var i = 0; i < METHODS.length; i++) if (METHODS[i].name === name) return METHODS[i];
    return null;
  }

  function currentPermit() { return permitById(state.permit); }
  function currentMethod() { return methodById(state.method); }

  /* Montant affiché : celui du serveur une fois le dossier enregistré,
     celui du catalogue avant. */
  function montant() {
    if (state.dossierMontant != null) return state.dossierMontant;
    var p = currentPermit();
    return p ? p.price : null;
  }

  /* Les trois états que le site distingue explicitement. Aucun n'affirme
     qu'une transaction a été encaissée : la vérification reste manuelle. */
  function payStatusLabel() {
    if (state.proof.name) return 'Preuve envoyée — en attente de vérification';
    if (state.declared) return 'Paiement en attente de vérification';
    return 'Paiement à effectuer';
  }

  function payRef() {
    var initials = form.nom ? form.nom.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) : '';
    return 'PE-' + (initials || 'DOSSIER');
  }

  /* ========================================================================
     5. Client API
     ======================================================================== */

  function api(chemin, options) {
    var opts = Object.assign({ credentials: 'same-origin' }, options || {});
    opts.headers = Object.assign(
      opts.body ? { 'Content-Type': 'application/json' } : {},
      opts.headers || {}
    );
    return fetch(chemin, opts).then(function (r) {
      return r.text().then(function (brut) {
        var donnees = null;
        try { donnees = brut ? JSON.parse(brut) : null; } catch (e) { /* réponse non JSON */ }
        if (r.ok) return donnees;
        var erreur = new Error(
          (donnees && donnees.erreur) || 'Le service est momentanément indisponible. Réessayez dans un instant.'
        );
        erreur.statut = r.status;
        erreur.donnees = donnees;
        throw erreur;
      });
    }, function () {
      throw new Error('Connexion impossible. Vérifiez votre connexion internet et réessayez.');
    });
  }

  /* ========================================================================
     6. Gestion des surcouches (parcours / admin / suivi)
     ======================================================================== */

  var lastFocused = null;
  var openOverlays = [];

  function lockScroll(locked) {
    document.body.style.overflow = locked ? 'hidden' : '';
  }

  function openOverlay(node, focusTarget) {
    if (openOverlays.indexOf(node) === -1) openOverlays.push(node);
    if (!lastFocused) lastFocused = document.activeElement;
    show(node, true);
    lockScroll(true);
    var target = focusTarget || $('button, input, [tabindex]', node);
    if (target) target.focus();
  }

  function closeOverlay(node) {
    show(node, false);
    openOverlays = openOverlays.filter(function (n) { return n !== node; });
    if (!openOverlays.length) {
      lockScroll(false);
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      lastFocused = null;
    }
  }

  /* Piège le focus dans la surcouche la plus haute et gère Échap. */
  document.addEventListener('keydown', function (e) {
    if (!openOverlays.length) return;
    var top = openOverlays[openOverlays.length - 1];

    if (e.key === 'Escape') {
      e.preventDefault();
      if (state.envoiEnCours) return;      // ne pas interrompre un envoi
      if (top === refs.funnel) closeFunnel();
      else if (top === refs.admin) closeAdmin();
      else if (top === refs.track) closeOverlay(refs.track);
      return;
    }

    if (e.key !== 'Tab') return;
    var focusables = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', top)
      .filter(function (n) { return n.offsetParent !== null; });
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ========================================================================
     7. Références DOM
     ======================================================================== */

  var refs = {};

  function collectRefs() {
    refs.promoBar = $('#promoBar');
    refs.gallery = $('#galerie');
    refs.burger = $('#burger');
    refs.navMobile = $('#navMobile');

    refs.funnel = $('#funnelOverlay');
    refs.funnelSteps = $$('#funnelSteps li');
    refs.stepSections = $$('.funnel-step');
    refs.permitGrid = $('#permitGrid');
    refs.infoForm = $('#infoForm');
    refs.formAlert = $('#formAlert');
    refs.confirmWrap = $('#confirmWrap');
    refs.confirmBtn = $('[data-action="confirm"]');
    refs.confirmHint = $('#confirmHint');
    refs.payTitle = $('#payTitle');
    refs.payMethods = $('#payMethods');

    refs.track = $('#trackOverlay');
    refs.trackInput = $('#trackInput');
    refs.trackEmail = $('#trackEmail');
    refs.trackError = $('#trackError');
    refs.trackResult = $('#trackResult');

    refs.admin = $('#adminOverlay');
    refs.adminGate = $('#adminGate');
    refs.adminBody = $('#adminBody');
    refs.adminPass = $('#adminPass');
    refs.adminError = $('#adminError');
    refs.adminListError = $('#adminListError');
    refs.adminList = $('#adminList');
    refs.adminEmpty = $('#adminEmpty');
    refs.adminCount = $('#adminCount');
  }

  /* ========================================================================
     8. Parcours d'inscription
     ======================================================================== */

  var STEP_TITLES = {
    1: 'Choix du permis',
    2: 'Vos informations',
    3: 'Vérification de la demande',
    4: 'Paiement',
    5: 'Confirmation'
  };

  function buildPermitGrid() {
    refs.permitGrid.textContent = '';
    PERMITS.forEach(function (p) {
      var btn = el('button', 'pick');
      btn.type = 'button';
      btn.setAttribute('data-action', 'pick-permit');
      btn.setAttribute('data-permit', p.id);
      btn.setAttribute('aria-pressed', 'false');

      var top = el('span', 'pick__top');
      top.appendChild(el('span', 'pick__cat', p.cat));
      var check = el('span', 'pick__check');
      check.setAttribute('aria-hidden', 'true');
      top.appendChild(check);

      btn.appendChild(top);
      btn.appendChild(el('span', 'pick__name', p.name));
      btn.appendChild(el('span', 'pick__desc', p.desc));
      refs.permitGrid.appendChild(btn);
    });
  }

  function renderFunnel() {
    var permit = currentPermit();
    var method = currentMethod();
    var m = montant();

    // Fil des étapes
    refs.funnelSteps.forEach(function (li) {
      var n = Number(li.getAttribute('data-step'));
      li.setAttribute('data-state', state.step === n ? 'active' : state.step > n ? 'done' : 'todo');
      li.firstElementChild.textContent = state.step > n ? '✓' : String(n);
      if (state.step === n) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });

    // Panneau visible
    refs.stepSections.forEach(function (section) {
      show(section, Number(section.getAttribute('data-step')) === state.step);
    });
    refs.funnel.setAttribute('aria-label', 'Inscription — étape ' + state.step + ' sur 5 : ' + STEP_TITLES[state.step]);

    // Sélection du permis
    $$('[data-action="pick-permit"]', refs.permitGrid).forEach(function (btn) {
      var on = btn.getAttribute('data-permit') === state.permit;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      $('.pick__check', btn).textContent = on ? '✓' : '';
    });

    // Valeurs partagées
    setBind('permitName', permit ? permit.name : (state.trackFound ? state.trackFound.permis : '—'));
    setBind('montant', m != null ? euros(m) : '—');
    setBind('rPrenom', form.prenom || '—');
    setBind('rNom', form.nom || '—');
    setBind('rVille', form.ville || '—');
    setBind('rAdresse', form.adresse || '—');
    setBind('rTel', form.tel || '—');
    setBind('rEmail', form.email || state.dossierEmail || '—');
    setBind('payRef', payRef());
    setBind('payMethodName', method ? method.name : '—');
    setBind('payStatusLabel', payStatusLabel());
    setBind('dossier', state.dossier || '—');
    setBind('invoiceNo', state.dossier ? state.dossier.replace('PE-', 'FA-') : '—');
    setBind('invoiceDate', state.dossierDate ? frJour(state.dossierDate) : '—');

    renderPayment();
  }

  function renderPayment() {
    /* Un seul moyen proposé : le choisir soi-même n'apporte rien, on le
       présélectionne et on masque la grille. Le jour où un second moyen est
       remis au catalogue, la grille réapparaît d'elle-même. */
    var moyenUnique = METHODS.length === 1;
    if (moyenUnique && !state.method) state.method = METHODS[0].id;
    show(refs.payMethods, !moyenUnique);
    if (refs.payTitle) {
      refs.payTitle.textContent = moyenUnique
        ? 'Réglez votre inscription' : 'Choisissez votre moyen de paiement';
    }

    var method = currentMethod();

    $$('[data-action="pick-method"]').forEach(function (btn) {
      var on = btn.getAttribute('data-method') === state.method;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      $('.pick__check', btn).textContent = on ? '✓' : '';
    });

    $$('[data-pay-panel]').forEach(function (panel) {
      show(panel, panel.getAttribute('data-pay-panel') === state.method);
    });

    $$('.declare-btn').forEach(function (btn) {
      btn.setAttribute('aria-pressed', state.declared ? 'true' : 'false');
      btn.textContent = declareLabel(state.declared);
    });

    $$('[data-proof-field]').forEach(function (label) {
      label.classList.toggle('is-filled', !!state.proof.name);
    });
    $$('[data-proof-name]').forEach(function (node) {
      node.textContent = state.proof.name ? 'Preuve jointe : ' + state.proof.name : '';
    });

    show(refs.confirmWrap, !!method);
    refs.confirmBtn.disabled = !state.proof.name || state.envoiEnCours;
    refs.confirmBtn.textContent = state.envoiEnCours ? 'Envoi en cours…' : 'Confirmer ma demande →';

    if (!state.envoiEnCours && !refs.confirmHint.dataset.erreur) {
      refs.confirmHint.classList.remove('confirm-hint--info');
      refs.confirmHint.textContent = state.proof.name
        ? '' : 'Une preuve de paiement est obligatoire pour confirmer.';
    }
  }

  function indication(texte, estErreur) {
    refs.confirmHint.textContent = texte;
    refs.confirmHint.classList.toggle('confirm-hint--info', !estErreur);
    if (estErreur) refs.confirmHint.dataset.erreur = '1';
    else delete refs.confirmHint.dataset.erreur;
  }

  function declareLabel(initiated) {
    return initiated ? 'Virement déclaré ✓' : 'J\'ai effectué le virement';
  }

  function goToStep(step) {
    state.step = step;
    renderFunnel();
    var body = $('.overlay__body', refs.funnel);
    if (body) body.scrollTop = 0;
    var heading = $('.funnel-step[data-step="' + step + '"] h2', refs.funnel);
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }

  function openFunnel(step) {
    openOverlay(refs.funnel);
    goToStep(step);
  }

  function closeFunnel() {
    closeOverlay(refs.funnel);
  }

  /* --- Formulaire ---------------------------------------------------- */

  function readForm() {
    Object.keys(form).forEach(function (key) {
      var input = refs.infoForm.elements[key];
      if (input) form[key] = input.value;
    });
  }

  function validateForm() {
    var errors = {};
    if (!form.prenom.trim()) errors.prenom = 'Le prénom est requis.';
    if (!form.nom.trim()) errors.nom = 'Le nom est requis.';
    if (!form.naissance) errors.naissance = 'La date de naissance est requise.';
    if (!form.tel.trim()) errors.tel = 'Le téléphone est requis.';
    else if (form.tel.replace(/[^0-9]/g, '').length < 8) errors.tel = 'Numéro de téléphone invalide.';
    if (!form.email.trim()) errors.email = 'L\'adresse e-mail est requise.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) errors.email = 'Adresse e-mail invalide.';
    if (!form.ville.trim()) errors.ville = 'La ville est requise.';
    if (!form.adresse.trim()) errors.adresse = 'L\'adresse est requise.';
    if (!form.pays.trim()) errors.pays = 'Le pays de résidence est requis.';
    return errors;
  }

  /* Les clés renvoyées par l'API portent les noms de la base ; on les
     rapproche des identifiants de champ de la page. */
  var CHAMPS_API = { telephone: 'tel' };

  function showFormErrors(errors) {
    var keys = ['prenom', 'nom', 'naissance', 'tel', 'email', 'ville', 'adresse', 'pays'];
    keys.forEach(function (key) {
      var input = refs.infoForm.elements[key];
      var slot = $('#e-' + key);
      var message = errors[key] || '';
      if (slot) slot.textContent = message;
      if (input) {
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    });
    var hasErrors = Object.keys(errors).length > 0;
    show(refs.formAlert, hasErrors);
    if (hasErrors) {
      var firstKey = keys.filter(function (k) { return errors[k]; })[0];
      var firstInput = refs.infoForm.elements[firstKey];
      if (firstInput) firstInput.focus();
    }
    return !hasErrors;
  }

  function clearFormErrors() {
    showFormErrors({});
  }

  function fillForm() {
    Object.keys(form).forEach(function (key) {
      var input = refs.infoForm.elements[key];
      if (input) input.value = form[key];
    });
  }

  /* --- Preuve de paiement --------------------------------------------- */

  function resetProof() {
    state.proof = { file: null, name: '' };
    $$('[data-proof-input]').forEach(function (input) { input.value = ''; });
  }

  function onProofChange(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > TAILLE_PREUVE_MAX) {
      resetProof();
      renderFunnel();
      indication('Fichier trop volumineux : 10 Mo maximum.', true);
      return;
    }
    state.proof = { file: file, name: file.name };
    indication('', false);
    renderFunnel();
  }

  /* --- Confirmation ---------------------------------------------------- */

  function confirmRequest() {
    if (!state.proof.file || state.envoiEnCours) return;

    var permit = currentPermit();
    var method = currentMethod();
    if (!method) return;

    state.envoiEnCours = true;
    indication('Envoi de votre preuve de paiement…', false);
    renderPayment();

    var fichier = state.proof.file;
    var jetonPreuve = null;

    // 1. Le serveur choisit le chemin du fichier et signe une URL de dépôt.
    api('/api/preuve-url', {
      method: 'POST',
      body: JSON.stringify({ nom: fichier.name, type: fichier.type, taille: fichier.size })
    }).then(function (rep) {
      jetonPreuve = rep.jeton;
      // 2. Le fichier part directement vers le stockage, sans transiter par
      //    la fonction serverless (qui plafonne à 4,5 Mo de corps de requête).
      return fetch(rep.url, {
        method: 'PUT',
        headers: { 'Content-Type': fichier.type },
        body: fichier
      }).then(function (r) {
        if (!r.ok) throw new Error('L\'envoi de la preuve a échoué. Réessayez.');
      }, function () {
        throw new Error('L\'envoi de la preuve a échoué. Vérifiez votre connexion.');
      });
    }).then(function () {
      indication('Enregistrement de votre demande…', false);
      // 3. Création du dossier, ou renvoi de preuve sur un dossier existant.
      var charge = state.dossier
        ? {
            numero: state.dossier,
            email: state.dossierEmail || form.email,
            moyen_id: method.id,
            preuve: jetonPreuve
          }
        : {
            permis_id: permit ? permit.id : '',
            moyen_id: method.id,
            preuve: jetonPreuve,
            prenom: form.prenom, nom: form.nom, naissance: form.naissance,
            email: form.email, telephone: form.tel, ville: form.ville,
            adresse: form.adresse, pays: form.pays, situation: form.situation
          };
      return api('/api/dossiers', { method: 'POST', body: JSON.stringify(charge) });
    }).then(function (rep) {
      state.dossier = rep.numero;
      state.dossierDate = rep.date;
      state.dossierMontant = rep.montant;
      state.dossierEmail = state.dossierEmail || form.email;
      state.envoiEnCours = false;
      indication('', false);
      goToStep(5);
    }).catch(function (e) {
      state.envoiEnCours = false;

      // 422 : le serveur a revalidé les informations et en refuse certaines.
      if (e.statut === 422 && e.donnees && e.donnees.champs) {
        var erreurs = {};
        Object.keys(e.donnees.champs).forEach(function (cle) {
          erreurs[CHAMPS_API[cle] || cle] = e.donnees.champs[cle];
        });
        renderPayment();
        goToStep(2);
        showFormErrors(erreurs);
        return;
      }

      renderPayment();
      indication(e.message, true);
    });
  }

  /* ========================================================================
     9. Suivi de dossier (côté client)
     ======================================================================== */

  function runTrack() {
    var numero = (refs.trackInput.value || '').trim().toUpperCase();
    var email = (refs.trackEmail.value || '').trim();

    if (!numero) {
      refs.trackError.textContent = 'Saisissez votre numéro de dossier.';
      show(refs.trackResult, false);
      return;
    }
    if (!email) {
      refs.trackError.textContent = 'Saisissez l\'adresse e-mail de votre demande.';
      show(refs.trackResult, false);
      return;
    }

    refs.trackError.textContent = 'Vérification…';
    api('/api/suivi', { method: 'POST', body: JSON.stringify({ numero: numero, email: email }) })
      .then(function (d) {
        refs.trackError.textContent = '';
        state.trackFound = d;
        state.dossierEmail = email;
        renderTrackResult(d);
      })
      .catch(function (e) {
        refs.trackError.textContent = e.message;
        state.trackFound = null;
        show(refs.trackResult, false);
      });
  }

  function renderTrackResult(d) {
    var status = STATUS[d.statut] || { label: '—', cls: 'pending' };

    $('#trackRef').textContent = d.numero;
    var pill = $('#trackStatus');
    pill.className = 'pill pill--' + status.cls;
    pill.textContent = status.label;

    $('#trackPermit').textContent = d.permis;
    $('#trackAmount').textContent = euros(d.montant);
    $('#trackMethod').textContent = d.moyen;

    var noteBox = $('#trackNoteBox');
    if (d.message) {
      noteBox.className = 'note-box note-box--' + status.cls;
      $('#trackNoteTitle').textContent = 'Message de notre équipe · ' + frDateHeure(d.decide_le);
      $('#trackNote').textContent = d.message;
      show(noteBox, true);
    } else {
      show(noteBox, false);
    }

    show($('#trackRetryWrap'), d.statut === 'rejected');
    show(refs.trackResult, true);
  }

  /* Le client renvoie une preuve : on le ramène directement à l'étape
     paiement. Ses informations restent côté serveur — seuls le dossier, le
     moyen de paiement et le nouveau fichier sont renvoyés. */
  function trackRetry() {
    var d = state.trackFound;
    if (!d) return;

    var permit = permitByName(d.permis);
    var method = methodByName(d.moyen);

    state.permit = permit ? permit.id : null;
    state.method = method ? method.id : null;
    state.dossier = d.numero;
    state.dossierDate = d.date;
    state.dossierMontant = d.montant;
    state.declared = false;
    resetProof();
    indication('', false);

    // On ouvre avant de fermer : la surcouche ne se vide jamais complètement,
    // le focus et le verrou de défilement restent donc stables.
    openFunnel(4);
    closeOverlay(refs.track);
  }

  /* ========================================================================
     10. Espace administrateur
     ======================================================================== */

  function openAdmin() {
    refs.adminError.textContent = '';
    refs.adminListError.textContent = '';
    state.records = [];
    state.adminChargement = true;
    openOverlay(refs.admin);
    renderAdmin();

    // Une session encore valide évite de redemander le code.
    api('/api/admin/session', { method: 'GET' }).then(function (d) {
      state.adminAuth = Boolean(d && d.ouverte);
      if (state.adminAuth) return chargerAdmin();
      renderAdmin();
      refs.adminPass.focus();
    }).catch(function () {
      state.adminAuth = false;
      renderAdmin();
      refs.adminPass.focus();
    });
  }

  function closeAdmin() {
    refs.adminPass.value = '';
    closeOverlay(refs.admin);
  }

  function adminLogin() {
    var code = refs.adminPass.value;
    if (!code) {
      refs.adminError.textContent = 'Saisissez le code d\'accès.';
      return;
    }
    refs.adminError.textContent = 'Vérification…';
    api('/api/admin/login', { method: 'POST', body: JSON.stringify({ code: code }) })
      .then(function () {
        refs.adminPass.value = '';
        refs.adminError.textContent = '';
        state.adminAuth = true;
        return chargerAdmin();
      })
      .catch(function (e) {
        state.adminAuth = false;
        refs.adminError.textContent = e.message;
        renderAdmin();
      });
  }

  function adminLogout() {
    return api('/api/admin/logout', { method: 'POST' }).catch(function () { /* sans conséquence */ })
      .then(function () {
        state.adminAuth = false;
        state.records = [];
        renderAdmin();
      });
  }

  function chargerAdmin() {
    refs.adminListError.textContent = '';
    // On vide la liste pendant le chargement : réafficher les dossiers de la
    // consultation précédente montrerait un état périmé — un dossier déjà
    // rejeté alors que le client vient d'envoyer une nouvelle preuve.
    state.records = [];
    state.adminChargement = true;
    renderAdmin();

    return api('/api/admin/dossiers?statut=' + encodeURIComponent(state.adminFilter), { method: 'GET' })
      .then(function (d) {
        state.records = d.dossiers || [];
        state.totaux = d.totaux || state.totaux;
        state.adminChargement = false;
        renderAdmin();
      })
      .catch(function (e) {
        state.adminChargement = false;
        // 401 : la session a expiré pendant la consultation.
        if (e.statut === 401) {
          state.adminAuth = false;
          renderAdmin();
          refs.adminError.textContent = 'Session expirée, reconnectez-vous.';
          return;
        }
        state.records = [];
        renderAdmin();
        refs.adminListError.textContent = e.message;
      });
  }

  function renderAdmin() {
    show(refs.adminGate, !state.adminAuth);
    show(refs.adminBody, state.adminAuth);
    if (!state.adminAuth) return;

    var totaux = state.totaux;
    var libelles = { all: 'Toutes', pending: 'En attente', approved: 'Validées', rejected: 'Rejetées' };
    $$('[data-filter]').forEach(function (btn) {
      var id = btn.getAttribute('data-filter');
      btn.textContent = libelles[id] + ' (' + (totaux[id] || 0) + ')';
      btn.setAttribute('aria-pressed', state.adminFilter === id ? 'true' : 'false');
    });

    var plural = totaux.all > 1 ? 's' : '';
    refs.adminCount.textContent = totaux.all + ' demande' + plural + ' enregistrée' + plural;

    refs.adminEmpty.textContent = state.adminChargement
      ? 'Chargement des demandes…'
      : 'Aucune demande dans cette catégorie pour le moment.';
    show(refs.adminEmpty,
      state.records.length === 0 && !refs.adminListError.textContent);

    refs.adminList.textContent = '';
    state.records.forEach(function (record) {
      refs.adminList.appendChild(buildAdminCard(record));
    });
  }

  function buildAdminCard(record) {
    var status = STATUS[record.statut] || { label: '—', cls: 'pending' };
    var card = el('div', 'admin-card');
    card.setAttribute('data-dossier', record.numero);

    /* En-tête */
    var head = el('div', 'admin-card__head');
    var left = el('div');
    var client = el('div', 'admin-card__client');
    client.appendChild(el('span', 'admin-card__name', record.client));
    client.appendChild(el('span', 'pill admin-card__pill pill--' + status.cls, status.label));
    left.appendChild(client);
    left.appendChild(el('p', 'admin-card__ref', record.numero + ' · ' + frJour(record.date)));
    if (record.renvoye_le) {
      left.appendChild(el('p', 'admin-card__resubmit',
        'Nouvelle preuve reçue le ' + frDateHeure(record.renvoye_le)));
    }
    head.appendChild(left);

    var money = el('div', 'admin-card__money');
    money.appendChild(el('p', 'admin-card__amount', euros(record.montant)));
    money.appendChild(el('p', 'admin-card__sub', record.permis + ' · ' + record.moyen));
    head.appendChild(money);
    card.appendChild(head);

    /* Coordonnées + preuve */
    var cols = el('div', 'admin-card__cols');

    var contactCol = el('div');
    contactCol.appendChild(el('p', 'admin-label', 'Coordonnées'));
    var contact = el('div', 'admin-contact');
    contact.appendChild(el('span', null, record.email || '—'));
    contact.appendChild(el('span', null, record.telephone || '—'));
    contact.appendChild(el('span', null, record.adresse || '—'));
    if (record.naissance) {
      contact.appendChild(el('span', 'admin-contact__mtcn', 'Né(e) le ' + frDate(record.naissance)));
    }
    if (record.reference_wu) {
      contact.appendChild(el('span', 'admin-contact__mtcn', 'MTCN : ' + record.reference_wu));
    }
    contactCol.appendChild(contact);
    cols.appendChild(contactCol);

    var proofCol = el('div', 'admin-proof');
    proofCol.appendChild(el('p', 'admin-label', 'Preuve de paiement'));
    proofCol.appendChild(el('p', 'admin-proof__name', record.preuve_nom || 'Aucun fichier'));

    if (record.a_preuve) {
      /* Le fichier est servi par /api/admin/preuve, protégé par la session :
         le stockage reste privé, sans URL publique. Le paramètre « v » évite
         qu'un ancien fichier reste en cache après un renvoi de preuve. */
      var version = encodeURIComponent(record.renvoye_le || record.date || '');
      var source = '/api/admin/preuve?numero=' + encodeURIComponent(record.numero) + '&v=' + version;
      var view = el('div', 'admin-proof__view');

      if ((record.preuve_type || '').indexOf('image/') === 0) {
        var img = document.createElement('img');
        img.src = source;
        img.alt = 'Preuve de paiement transmise par ' + record.client;
        img.loading = 'lazy';
        view.appendChild(img);
      } else {
        var frame = document.createElement('iframe');
        frame.src = source;
        frame.title = 'Preuve de paiement transmise par ' + record.client;
        view.appendChild(frame);
      }
      proofCol.appendChild(view);

      var dl = document.createElement('a');
      dl.className = 'admin-proof__download';
      dl.href = source + '&telecharger=1';
      dl.textContent = 'Télécharger le fichier';
      proofCol.appendChild(dl);
    } else {
      proofCol.appendChild(el('p', 'admin-proof__missing', 'Aucun fichier transmis.'));
    }
    cols.appendChild(proofCol);
    card.appendChild(cols);

    /* Décision */
    var decide = el('div', 'admin-decide');

    if (record.statut === 'pending') {
      var label = el('label', 'admin-decide__label');
      label.setAttribute('for', 'msg-' + record.numero);
      label.appendChild(document.createTextNode('Message au client '));
      label.appendChild(el('span', 'admin-decide__req', '— obligatoire en cas de rejet'));
      decide.appendChild(label);

      var textarea = document.createElement('textarea');
      textarea.id = 'msg-' + record.numero;
      textarea.rows = 3;
      textarea.placeholder = 'Ex. : Paiement bien reçu, votre formation démarre la semaine prochaine. / La preuve envoyée est illisible, merci de renvoyer le reçu complet.';
      textarea.value = state.adminMsg[record.numero] || '';
      textarea.addEventListener('input', function () {
        state.adminMsg[record.numero] = textarea.value;
      });
      decide.appendChild(textarea);

      var actions = el('div', 'admin-decide__actions');
      var approve = el('button', 'btn-approve', 'Valider le paiement');
      approve.type = 'button';
      approve.addEventListener('click', function () { decider(record.numero, 'approved', approve); });
      var reject = el('button', 'btn-reject', 'Rejeter la preuve');
      reject.type = 'button';
      reject.addEventListener('click', function () { decider(record.numero, 'rejected', reject); });
      var error = el('span', 'admin-decide__error');
      error.setAttribute('data-decide-error', '');
      error.setAttribute('role', 'alert');
      actions.appendChild(approve);
      actions.appendChild(reject);
      actions.appendChild(error);
      decide.appendChild(actions);
    } else {
      decide.appendChild(el('p', 'admin-locked', record.statut === 'approved'
        ? 'Dossier validé — aucune nouvelle décision possible tant que le client n\'a pas transmis une nouvelle preuve.'
        : 'Preuve rejetée — en attente d\'une nouvelle preuve de paiement du client.'));
    }

    if (record.historique && record.historique.length) {
      decide.appendChild(el('p', 'admin-history', 'Historique : ' + record.historique.map(function (h) {
        return (h.statut === 'approved' ? 'Validé' : 'Rejeté') + ' le ' + frDateHeure(h.le) + ' — ' + h.message;
      }).join(' · ')));
    }

    if (record.decide_le) {
      var box = el('div', 'note-box admin-decision note-box--' + status.cls);
      box.appendChild(el('p', 'note-box__title', 'Décision transmise au client · ' + frDateHeure(record.decide_le)));
      box.appendChild(el('p', 'note-box__body', record.message));
      decide.appendChild(box);
    }

    card.appendChild(decide);
    return card;
  }

  function erreurDecision(numero, texte) {
    var card = $('.admin-card[data-dossier="' + (window.CSS && CSS.escape ? CSS.escape(numero) : numero) + '"]', refs.adminList);
    var slot = card && $('[data-decide-error]', card);
    if (slot) slot.textContent = texte;
  }

  function decider(numero, statut, bouton) {
    var message = (state.adminMsg[numero] || '').trim();

    // Contrôle local pour un retour immédiat ; le serveur applique la même
    // règle, c'est lui qui fait autorité.
    if (statut === 'rejected' && !message) {
      erreurDecision(numero, 'Indiquez la raison du rejet avant de rejeter.');
      return;
    }

    erreurDecision(numero, '');
    if (bouton) bouton.disabled = true;

    api('/api/admin/decision', {
      method: 'POST',
      body: JSON.stringify({ numero: numero, statut: statut, message: message })
    }).then(function () {
      delete state.adminMsg[numero];
      return chargerAdmin();
    }).catch(function (e) {
      if (bouton) bouton.disabled = false;
      if (e.statut === 401) {
        state.adminAuth = false;
        renderAdmin();
        refs.adminError.textContent = 'Session expirée, reconnectez-vous.';
        return;
      }
      erreurDecision(numero, e.message);
    });
  }

  /* ========================================================================
     11. Facture
     ======================================================================== */

  function invoiceHtml() {
    var permit = currentPermit();
    var method = currentMethod();
    var prix = montant() || 0;
    var invoiceNo = state.dossier.replace('PE-', 'FA-');
    var mentions = mentionsLegales();
    var nomFormation = permit ? permit.name : (state.trackFound ? state.trackFound.permis : '—');

    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function row(key, value) {
      return '<tr><td style="padding:5px 0;color:#8B90A0">' + esc(key) +
        '</td><td style="padding:5px 0;text-align:right;font-weight:600">' + esc(value) + '</td></tr>';
    }

    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Facture ' + esc(invoiceNo) + '</title>' +
      '<style>@page{size:A4;margin:18mm}body{font-family:Helvetica,Arial,sans-serif;color:#12141C;margin:0;font-size:13px;line-height:1.6}' +
      'h1{font-size:26px;letter-spacing:.02em;text-transform:uppercase;margin:0}table{width:100%;border-collapse:collapse}' +
      '.band{height:4px;background:linear-gradient(90deg,#1E3F94 0 33%,#F5F5F5 33% 66%,#C1121F 66% 100%);margin:18px 0 26px}' +
      '.box{border:1px solid #E6E7EC;border-radius:10px;padding:18px;margin-bottom:16px}' +
      '.lbl{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8B90A0;font-weight:700;margin-bottom:8px}</style></head><body>' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px">' +
      '<div><h1>Permis <span style="color:#B8880E">Express</span></h1>' +
      '<div style="color:#8B90A0;font-size:12px">Votre permis, notre priorité</div>' +
      '<div style="margin-top:10px;font-size:12px;color:#5A5F6E">' + esc(SITE.contact.phone) + '<br>' +
      esc(mentions ? mentions.adresse : 'Coordonnées société à compléter') + '</div></div>' +
      '<div style="text-align:right"><div style="font-size:18px;font-weight:700">FACTURE</div>' +
      '<div style="font-family:monospace;margin-top:6px">' + esc(invoiceNo) + '</div>' +
      '<div style="color:#8B90A0">' + esc(frJour(state.dossierDate)) + '</div>' +
      '<div style="color:#8B90A0">Dossier ' + esc(state.dossier) + '</div></div></div><div class="band"></div>' +
      '<div class="box"><div class="lbl">Client</div><table>' +
      row('Nom et prénom', (form.prenom + ' ' + form.nom).trim() || '—') +
      row('Adresse', form.adresse || '—') +
      row('Ville', form.ville || '—') +
      row('Pays', form.pays || '—') +
      row('Téléphone', form.tel || '—') +
      row('E-mail', form.email || state.dossierEmail || '—') +
      row('Date de naissance', frDate(form.naissance) || '—') +
      '</table></div>' +
      '<div class="box"><div class="lbl">Détail de la commande</div><table><thead><tr>' +
      '<th style="text-align:left;border-bottom:1px solid #E6E7EC;padding-bottom:8px;font-size:11px;color:#8B90A0;text-transform:uppercase">Prestation</th>' +
      '<th style="text-align:right;border-bottom:1px solid #E6E7EC;padding-bottom:8px;font-size:11px;color:#8B90A0;text-transform:uppercase">Montant</th>' +
      '</tr></thead><tbody>' +
      '<tr><td style="padding:12px 0">' + esc(nomFormation) + ' — accompagnement complet</td>' +
      '<td style="padding:12px 0;text-align:right">' + prix + ' €</td></tr>' +
      '<tr><td style="padding:12px 0;border-top:1px solid #E6E7EC;font-weight:700">Total à régler</td>' +
      '<td style="padding:12px 0;border-top:1px solid #E6E7EC;text-align:right;font-weight:700;font-size:18px">' + prix + ' €</td></tr>' +
      '</tbody></table></div>' +
      '<div class="box"><div class="lbl">Paiement</div><table>' +
      row('Moyen de paiement', method ? method.name : '—') +
      row('Preuve transmise', state.proof.name || '—') +
      row('Statut', payStatusLabel()) +
      '</table><div style="margin-top:12px;font-size:12px;color:#5A5F6E">Ce document confirme l\'enregistrement de votre commande. ' +
      'Il ne vaut pas quittance : le paiement sera vérifié par notre équipe, qui vous adressera la confirmation définitive.</div></div>' +
      '<div style="font-size:11px;color:#8B90A0;margin-top:20px">' +
      esc(mentions ? mentions.ligne
        : 'Mentions légales et informations société à compléter (SIRET, TVA, adresse).') + '</div>' +
      '</body></html>';
  }

  /* Impression via un iframe caché : pas de pop-up à autoriser. Si
     l'impression est bloquée, on retombe sur un téléchargement du document. */
  function printInvoice() {
    if (!state.dossier) return;
    var html = invoiceHtml();

    var old = document.getElementById('pe-invoice-frame');
    if (old) old.remove();

    var frame = document.createElement('iframe');
    frame.id = 'pe-invoice-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    frame.srcdoc = html;
    frame.onload = function () {
      try {
        var win = frame.contentWindow;
        win.focus();
        win.onafterprint = function () { setTimeout(function () { frame.remove(); }, 200); };
        win.print();
      } catch (e) {
        var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        var link = document.createElement('a');
        link.href = url;
        link.download = 'facture-' + state.dossier.replace('PE-', 'FA-') + '.html';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        frame.remove();
      }
    };
    document.body.appendChild(frame);
  }

  /* ========================================================================
     12. Copie dans le presse-papiers
     ======================================================================== */

  function copyValue(button, text) {
    var original = 'Copier';
    function done() {
      button.textContent = 'Copié ✓';
      setTimeout(function () { button.textContent = original; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  }

  /* ========================================================================
     13. Câblage des évènements
     ======================================================================== */

  var ACTIONS = {
    start: function () {
      closeMobileNav();
      nouvelleDemande();
      openFunnel(state.permit ? 2 : 1);
    },
    choose: function (btn) {
      closeMobileNav();
      nouvelleDemande();
      state.permit = btn.getAttribute('data-permit');
      clearFormErrors();
      openFunnel(2);
    },
    'pick-permit': function (btn) {
      state.permit = btn.getAttribute('data-permit');
      state.dossierMontant = null;
      clearFormErrors();
      goToStep(2);
    },
    'back-permit': function () { goToStep(1); },
    'submit-info': function () {
      readForm();
      var errors = validateForm();
      if (showFormErrors(errors)) goToStep(3);
    },
    'edit-info': function () { goToStep(2); },
    'to-pay': function () { goToStep(4); },
    'back-recap': function () { goToStep(3); },
    'pick-method': function (btn) {
      state.method = btn.getAttribute('data-method');
      state.declared = false;
      resetProof();
      indication('', false);
      renderFunnel();
    },
    declare: function () {
      state.declared = !state.declared;
      renderFunnel();
    },
    confirm: function () { confirmRequest(); },
    invoice: function () { printInvoice(); },
    'funnel-close': function () { if (!state.envoiEnCours) closeFunnel(); },

    track: function () {
      closeMobileNav();
      refs.trackError.textContent = '';
      state.trackFound = null;
      show(refs.trackResult, false);
      openOverlay(refs.track, refs.trackInput);
    },
    'track-close': function () { closeOverlay(refs.track); },
    'track-run': function () { runTrack(); },
    'track-retry': function () { trackRetry(); },

    admin: function () { closeMobileNav(); openAdmin(); },
    'admin-close': function () { closeAdmin(); },
    'admin-login': function () { adminLogin(); },
    'admin-logout': function () { adminLogout(); },

    copy: function (btn) {
      var key = btn.getAttribute('data-copy');
      var values = {
        holder: SITE.bank.holder,
        // L'IBAN se colle sans espaces : les formulaires bancaires les refusent
        // souvent, et les banques les ignorent de toute façon.
        iban: SITE.bank.iban.replace(/\s+/g, ''),
        bic: SITE.bank.bic,
        rib: SITE.bank.rib,
        ref: payRef()
      };
      copyValue(btn, values[key] || '');
    }
  };

  /* Repart d'une demande vierge : sans cela, un second client sur le même
     appareil renverrait une preuve sur le dossier du précédent. */
  function nouvelleDemande() {
    if (!state.dossier) return;
    state.dossier = '';
    state.dossierDate = '';
    state.dossierMontant = null;
    state.dossierEmail = '';
    state.trackFound = null;
    state.method = null;
    state.declared = false;
    resetProof();
    indication('', false);
  }

  function closeMobileNav() {
    show(refs.navMobile, false);
    refs.burger.setAttribute('aria-expanded', 'false');
    refs.burger.setAttribute('aria-label', 'Ouvrir le menu');
  }

  function wire() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = ACTIONS[btn.getAttribute('data-action')];
      if (!action) return;
      e.preventDefault();
      action(btn);
    });

    refs.burger.addEventListener('click', function () {
      var open = refs.navMobile.hidden;
      show(refs.navMobile, open);
      refs.burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      refs.burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    });

    $$('#navMobile a').forEach(function (link) {
      link.addEventListener('click', closeMobileNav);
    });

    // Le formulaire n'est jamais soumis : la validation et la navigation
    // se font par étapes.
    refs.infoForm.addEventListener('submit', function (e) {
      e.preventDefault();
      ACTIONS['submit-info']();
    });

    refs.infoForm.addEventListener('input', function (e) {
      var name = e.target.name;
      if (name && Object.prototype.hasOwnProperty.call(form, name)) {
        form[name] = e.target.value;
        // On efface l'erreur du champ dès qu'il est corrigé.
        var slot = $('#e-' + name);
        if (slot && slot.textContent) {
          slot.textContent = '';
          e.target.removeAttribute('aria-invalid');
        }
      }
    });

    $$('[data-proof-input]').forEach(function (input) {
      input.addEventListener('change', function () { onProofChange(input); });
    });

    [refs.trackInput, refs.trackEmail].forEach(function (champ) {
      champ.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); runTrack(); }
      });
    });

    refs.adminPass.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); adminLogin(); }
    });
    refs.adminPass.addEventListener('input', function () { refs.adminError.textContent = ''; });

    $$('[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.adminFilter = btn.getAttribute('data-filter');
        chargerAdmin();
      });
    });
  }

  /* ========================================================================
     14. Démarrage
     ======================================================================== */

  function init() {
    collectRefs();

    show(refs.promoBar, SITE.promoBar);
    show(refs.gallery, SITE.gallery);

    $('#bankHolder').textContent = SITE.bank.holder;
    $('#bankIban').textContent = SITE.bank.iban;
    $('#bankBic').textContent = SITE.bank.bic;
    $('#bankRib').textContent = SITE.bank.rib;
    show($('#bankTodo'), !SITE.bank.complete);

    // Signale une saisie invalide plutôt que de la laisser disparaître en silence.
    if ((SITE.company.siret || SITE.company.tva) && !mentionsLegales()) {
      console.warn('[Permis Express] SIRET ou numéro de TVA invalide : les mentions '
        + 'légales ne seront pas imprimées sur les factures.');
    }

    fillForm();
    wire();

    chargerCatalogue().then(function () {
      buildPermitGrid();
      renderFunnel();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
