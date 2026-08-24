/* ==========================================================================
   Permis Express — logique du site
   Parcours : permis → informations → récapitulatif → paiement → confirmation,
   plus le suivi de dossier client et l'espace administrateur.

   Aucune dépendance, aucune étape de build : le fichier est chargé tel quel.
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

    /* Coordonnées bancaires (virement) — À COMPLÉTER */
    bank: {
      holder: 'PERMIS EXPRESS (à compléter)',
      iban: 'FR76 •••• •••• •••• •••• •••• ••• (à compléter)',
      bic: '•••••••• (à compléter)',
      complete: false // passer à true une fois les vraies coordonnées saisies
    },

    /* Western Union — À COMPLÉTER */
    westernUnion: {
      beneficiary: 'Nom du bénéficiaire (à compléter)',
      city: 'Ville / pays (à compléter)',
      complete: false
    },

    /* Contact affiché sur la facture */
    contact: {
      phone: '+33 6 76 32 61 99',
      legal: 'Coordonnées société à compléter'
    },

    /* Facture : mentions légales — À COMPLÉTER (SIRET, TVA, adresse) */
    invoiceLegal: 'Mentions légales et informations société à compléter (SIRET, TVA, adresse).',

    /* ATTENTION — code d'accès administrateur.
       Il est lisible par quiconque ouvre le code source de la page. C'est une
       protection de façade, acceptable pour une démonstration uniquement.
       Pour un usage réel, déplacer les dossiers et cette vérification côté
       serveur (voir README.md § « Limites connues »). */
    adminCode: '#Capaciteur200K#'
  };

  /* Point d'intégration Wero : lorsque l'API/le lien officiel sera disponible,
     l'appeler ici et renvoyer une promesse. Tant que ce n'est pas branché, le
     site ne prétend jamais qu'une transaction a eu lieu. */
  function startWeroPayment(/* dossier, montant */) {
    return Promise.reject(new Error('Wero non raccordé'));
  }

  /* ========================================================================
     2. CATALOGUE
     Source de vérité des prix pour le parcours, le récapitulatif et la
     facture. La section Tarifs de index.html les répète en HTML statique
     (pour le référencement) : checkCatalogue() signale toute divergence.
     ======================================================================== */

  var PERMITS = [
    { id: 'B',    cat: 'Voiture',     name: 'Permis B',          desc: 'Le permis voiture classique.',            price: 800 },
    { id: 'FULL', cat: 'Voiture',     name: 'Permis complet',    desc: 'Code de la route + permis B, tout inclus.', price: 1000 },
    { id: 'A1',   cat: 'Moto',        name: 'Permis A1',         desc: 'Motos légères jusqu\'à 125 cm³.',         price: 500 },
    { id: 'A2',   cat: 'Moto',        name: 'Permis A2',         desc: 'Motos de puissance intermédiaire.',       price: 650 },
    { id: 'C',    cat: 'Poids lourd', name: 'Permis C',          desc: 'Véhicules de transport de marchandises.', price: 1300 },
    { id: 'D',    cat: 'Transport',   name: 'Permis D',          desc: 'Transport de personnes (bus, autocar).',  price: 2000 },
    { id: 'BE',   cat: 'Remorque',    name: 'Permis BE',         desc: 'Voiture avec remorque lourde.',           price: 500 },
    { id: 'CODE', cat: 'Théorie',     name: 'Code de la route',  desc: 'Préparation et passage du code seul.',    price: 250 }
  ];

  var METHODS = [
    { id: 'vir',  name: 'Virement bancaire' },
    { id: 'wero', name: 'Wero' },
    { id: 'wu',   name: 'Western Union' }
  ];

  var STATUS = {
    pending:  { label: 'En attente de vérification', cls: 'pending' },
    approved: { label: 'Paiement validé',            cls: 'approved' },
    rejected: { label: 'Preuve rejetée',             cls: 'rejected' }
  };

  var STORE_KEY = 'pe_dossiers_v1';

  /* ========================================================================
     3. ÉTAT
     ======================================================================== */

  var state = {
    step: 1,
    permit: null,          // id de PERMITS
    method: null,          // id de METHODS
    declared: false,       // le client a déclaré avoir effectué le paiement
    proof: { name: '', data: '', type: '' },
    wuRef: '',
    dossier: '',
    invoiceDate: '',
    records: [],
    adminAuth: false,
    adminFilter: 'all',
    adminMsg: {},          // dossier -> message en cours de saisie
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

  function nowDateTime() { return new Date().toLocaleString('fr-FR'); }

  /* « 1995-11-03 » (valeur d'un input[type=date]) → « 03/11/1995 ». */
  function frDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '');
  }

  function nowDate() {
    return new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
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
     5. Stockage des dossiers
     Limite connue : localStorage est propre au navigateur du visiteur.
     Un véritable back-office demande une base et une API côté serveur.
     ======================================================================== */

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveRecords(records) {
    state.records = records;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(records));
    } catch (e) {
      // Quota dépassé : on conserve les dossiers sans les fichiers de preuve,
      // qui restent disponibles en mémoire pour la session en cours.
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(records.map(function (r) {
          var copy = Object.assign({}, r);
          copy.proofData = '';
          copy.proofTruncated = true;
          return copy;
        })));
      } catch (e2) { /* rien de plus à tenter */ }
    }
  }

  /* Relit le stockage et réinjecte les preuves gardées en mémoire. */
  function syncRecords() {
    var stored = readStore();
    var live = state.records;
    var merged = stored.map(function (r) {
      if (r.proofData) return r;
      for (var i = 0; i < live.length; i++) {
        if (live[i].dossier === r.dossier && live[i].proofData) {
          return Object.assign({}, r, { proofData: live[i].proofData, proofType: live[i].proofType });
        }
      }
      return r;
    });
    live.forEach(function (r) {
      var known = merged.some(function (x) { return x.dossier === r.dossier; });
      if (!known) merged.push(r);
    });
    state.records = merged;
    return merged;
  }

  function findRecord(dossier) {
    for (var i = 0; i < state.records.length; i++) {
      if (state.records[i].dossier === dossier) return state.records[i];
    }
    return null;
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
    refs.mtcn = $('#f-mtcn');

    refs.track = $('#trackOverlay');
    refs.trackInput = $('#trackInput');
    refs.trackError = $('#trackError');
    refs.trackResult = $('#trackResult');

    refs.admin = $('#adminOverlay');
    refs.adminGate = $('#adminGate');
    refs.adminBody = $('#adminBody');
    refs.adminPass = $('#adminPass');
    refs.adminError = $('#adminError');
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
    setBind('permitName', permit ? permit.name : '—');
    setBind('montant', permit ? euros(permit.price) : '—');
    setBind('rPrenom', form.prenom || '—');
    setBind('rNom', form.nom || '—');
    setBind('rVille', form.ville || '—');
    setBind('rAdresse', form.adresse || '—');
    setBind('rTel', form.tel || '—');
    setBind('rEmail', form.email || '—');
    setBind('payRef', payRef());
    setBind('payMethodName', method ? method.name : '—');
    setBind('payStatusLabel', payStatusLabel());
    setBind('dossier', state.dossier || '—');
    setBind('invoiceNo', state.dossier ? state.dossier.replace('PE-', 'FA-') : '—');
    setBind('invoiceDate', state.invoiceDate || '—');

    renderPayment();
  }

  function renderPayment() {
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
      btn.textContent = declareLabel(btn.closest('[data-pay-panel]').getAttribute('data-pay-panel'), state.declared);
    });

    $$('[data-proof-field]').forEach(function (label) {
      label.classList.toggle('is-filled', !!state.proof.name);
    });
    $$('[data-proof-name]').forEach(function (node) {
      node.textContent = state.proof.name ? 'Preuve jointe : ' + state.proof.name : '';
    });

    show(refs.confirmWrap, !!method);
    refs.confirmBtn.disabled = !state.proof.name;
    refs.confirmHint.textContent = state.proof.name ? '' : 'Une preuve de paiement est obligatoire pour confirmer.';
  }

  function declareLabel(panel, initiated) {
    if (panel === 'wero') return initiated ? 'Demande Wero enregistrée ✓' : 'Valider — être recontacté via Wero';
    if (panel === 'wu') return initiated ? 'Transfert déclaré ✓' : 'J\'ai effectué le transfert';
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
    state.proof = { name: '', data: '', type: '' };
    $$('[data-proof-input]').forEach(function (input) { input.value = ''; });
  }

  function onProofChange(input) {
    var file = input.files && input.files[0];
    if (!file) return;
    state.proof.name = file.name;
    state.proof.type = file.type;
    var reader = new FileReader();
    reader.onload = function () {
      state.proof.data = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    renderFunnel();
  }

  /* --- Confirmation ---------------------------------------------------- */

  function confirmRequest() {
    if (!state.proof.name) return;

    var permit = currentPermit();
    var method = currentMethod();
    var id = state.dossier || ('PE-' + new Date().getFullYear() + '-' + String(Math.floor(1000 + Math.random() * 9000)));
    var date = state.invoiceDate || nowDate();

    syncRecords();
    var existing = findRecord(id);

    if (existing) {
      // Renvoi d'une preuve : le dossier repasse en attente, la décision
      // précédente est archivée.
      saveRecords(state.records.map(function (r) {
        if (r.dossier !== id) return r;
        var history = (r.history || []).slice();
        if (r.decidedAt) history.push({ status: r.status, note: r.note, at: r.decidedAt });
        return Object.assign({}, r, {
          proofName: state.proof.name,
          proofData: state.proof.data,
          proofType: state.proof.type,
          wuRef: state.wuRef,
          methodId: method ? method.id : r.methodId,
          method: method ? method.name : r.method,
          status: 'pending',
          decidedAt: '',
          note: '',
          history: history,
          resubmittedAt: nowDateTime()
        });
      }));
    } else {
      saveRecords(state.records.concat([{
        dossier: id,
        date: date,
        client: (form.prenom + ' ' + form.nom).trim() || '—',
        prenom: form.prenom,
        nom: form.nom,
        naissance: form.naissance,
        email: form.email,
        tel: form.tel,
        ville: form.ville,
        adresse: form.adresse,
        pays: form.pays,
        situation: form.situation,
        address: [form.adresse, form.ville, form.pays].filter(Boolean).join(', '),
        permitId: permit ? permit.id : '',
        permit: permit ? permit.name : '—',
        amount: permit ? euros(permit.price) : '—',
        methodId: method ? method.id : '',
        method: method ? method.name : '—',
        wuRef: state.wuRef,
        proofName: state.proof.name,
        proofData: state.proof.data,
        proofType: state.proof.type,
        status: 'pending',
        note: '',
        decidedAt: '',
        history: []
      }]));
    }

    state.dossier = id;
    state.invoiceDate = date;
    goToStep(5);
  }

  /* ========================================================================
     9. Suivi de dossier (côté client)
     ======================================================================== */

  function runTrack() {
    var id = (refs.trackInput.value || '').trim().toUpperCase();
    if (!id) {
      refs.trackError.textContent = 'Saisissez votre numéro de dossier.';
      state.trackFound = null;
      show(refs.trackResult, false);
      return;
    }
    syncRecords();
    var found = null;
    for (var i = 0; i < state.records.length; i++) {
      if (String(state.records[i].dossier).toUpperCase() === id) { found = state.records[i]; break; }
    }
    if (!found) {
      refs.trackError.textContent = 'Aucun dossier ne correspond à ce numéro sur cet appareil.';
      state.trackFound = null;
      show(refs.trackResult, false);
      return;
    }
    refs.trackError.textContent = '';
    state.trackFound = found;
    renderTrackResult(found);
  }

  function renderTrackResult(record) {
    var status = STATUS[record.status] || { label: '—', cls: 'pending' };

    $('#trackRef').textContent = record.dossier;
    var pill = $('#trackStatus');
    pill.className = 'pill pill--' + status.cls;
    pill.textContent = status.label;

    $('#trackPermit').textContent = record.permit;
    $('#trackAmount').textContent = record.amount;
    $('#trackMethod').textContent = record.method;

    var noteBox = $('#trackNoteBox');
    if (record.note) {
      noteBox.className = 'note-box note-box--' + status.cls;
      $('#trackNoteTitle').textContent = 'Message de notre équipe · ' + record.decidedAt;
      $('#trackNote').textContent = record.note;
      show(noteBox, true);
    } else {
      show(noteBox, false);
    }

    show($('#trackRetryWrap'), record.status === 'rejected');
    show(refs.trackResult, true);
  }

  /* Le client renvoie une preuve : on restaure son dossier et on le ramène
     directement à l'étape paiement. */
  function trackRetry() {
    var record = state.trackFound;
    if (!record) return;

    var permit = record.permitId ? permitById(record.permitId) : permitByName(record.permit);
    var method = record.methodId ? methodById(record.methodId) : methodByName(record.method);

    form.prenom = record.prenom || '';
    form.nom = record.nom || '';
    form.naissance = record.naissance || '';
    form.tel = record.tel || '';
    form.email = record.email || '';
    form.ville = record.ville || '';
    form.adresse = record.adresse || '';
    form.pays = record.pays || 'France';
    form.situation = record.situation || '';
    fillForm();

    state.permit = permit ? permit.id : null;
    state.method = method ? method.id : null;
    state.wuRef = record.wuRef || '';
    if (refs.mtcn) refs.mtcn.value = state.wuRef;
    state.dossier = record.dossier;
    state.invoiceDate = record.date || '';
    state.declared = false;
    resetProof();

    // On ouvre avant de fermer : la surcouche ne se vide jamais complètement,
    // le focus et le verrou de défilement restent donc stables.
    openFunnel(4);
    closeOverlay(refs.track);
  }

  /* ========================================================================
     10. Espace administrateur
     ======================================================================== */

  var previewUrls = [];

  function releasePreviews() {
    previewUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    previewUrls = [];
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var match = parts[0].match(/:(.*?);/);
    var mime = (match && match[1]) || 'application/octet-stream';
    var binary = atob(parts[1] || '');
    var buffer = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    return new Blob([buffer], { type: mime });
  }

  function objectUrlFor(dataUrl) {
    var url = URL.createObjectURL(dataUrlToBlob(dataUrl));
    previewUrls.push(url);
    return url;
  }

  function downloadProof(record) {
    if (!record.proofData) return;
    var url = URL.createObjectURL(dataUrlToBlob(record.proofData));
    var link = document.createElement('a');
    link.href = url;
    link.download = record.proofName || 'preuve-paiement';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function openAdmin() {
    syncRecords();
    refs.adminError.textContent = '';
    openOverlay(refs.admin);
    renderAdmin();
    if (!state.adminAuth) refs.adminPass.focus();
  }

  function closeAdmin() {
    refs.adminPass.value = '';
    releasePreviews();
    closeOverlay(refs.admin);
  }

  function adminLogin() {
    if (refs.adminPass.value === SITE.adminCode) {
      state.adminAuth = true;
      refs.adminPass.value = '';
      refs.adminError.textContent = '';
      renderAdmin();
    } else {
      refs.adminError.textContent = 'Code d\'accès incorrect.';
    }
  }

  function renderAdmin() {
    show(refs.adminGate, !state.adminAuth);
    show(refs.adminBody, state.adminAuth);
    if (!state.adminAuth) return;

    var records = state.records;

    // Filtres et compteurs
    $$('[data-filter]').forEach(function (btn) {
      var id = btn.getAttribute('data-filter');
      var count = id === 'all' ? records.length : records.filter(function (r) { return r.status === id; }).length;
      var labels = { all: 'Toutes', pending: 'En attente', approved: 'Validées', rejected: 'Rejetées' };
      btn.textContent = labels[id] + ' (' + count + ')';
      btn.setAttribute('aria-pressed', state.adminFilter === id ? 'true' : 'false');
    });

    var plural = records.length > 1 ? 's' : '';
    refs.adminCount.textContent = records.length + ' demande' + plural + ' enregistrée' + plural;

    var visible = records.filter(function (r) {
      return state.adminFilter === 'all' || r.status === state.adminFilter;
    }).slice().reverse();

    show(refs.adminEmpty, visible.length === 0);

    releasePreviews();
    refs.adminList.textContent = '';
    visible.forEach(function (record) {
      refs.adminList.appendChild(buildAdminCard(record));
    });
  }

  function buildAdminCard(record) {
    var status = STATUS[record.status] || { label: '—', cls: 'pending' };
    var card = el('div', 'admin-card');
    card.setAttribute('data-dossier', record.dossier);

    /* En-tête */
    var head = el('div', 'admin-card__head');
    var left = el('div');
    var client = el('div', 'admin-card__client');
    client.appendChild(el('span', 'admin-card__name', record.client));
    client.appendChild(el('span', 'pill admin-card__pill pill--' + status.cls, status.label));
    left.appendChild(client);
    left.appendChild(el('p', 'admin-card__ref', record.dossier + ' · ' + record.date));
    if (record.resubmittedAt) {
      left.appendChild(el('p', 'admin-card__resubmit', 'Nouvelle preuve reçue le ' + record.resubmittedAt));
    }
    head.appendChild(left);

    var money = el('div', 'admin-card__money');
    money.appendChild(el('p', 'admin-card__amount', record.amount));
    money.appendChild(el('p', 'admin-card__sub', record.permit + ' · ' + record.method));
    head.appendChild(money);
    card.appendChild(head);

    /* Coordonnées + preuve */
    var cols = el('div', 'admin-card__cols');

    var contactCol = el('div');
    contactCol.appendChild(el('p', 'admin-label', 'Coordonnées'));
    var contact = el('div', 'admin-contact');
    contact.appendChild(el('span', null, record.email || '—'));
    contact.appendChild(el('span', null, record.tel || '—'));
    contact.appendChild(el('span', null, record.address || '—'));
    if (record.wuRef) contact.appendChild(el('span', 'admin-contact__mtcn', 'MTCN : ' + record.wuRef));
    contactCol.appendChild(contact);
    cols.appendChild(contactCol);

    var proofCol = el('div', 'admin-proof');
    proofCol.appendChild(el('p', 'admin-label', 'Preuve de paiement'));
    proofCol.appendChild(el('p', 'admin-proof__name', record.proofName || 'Aucun fichier'));

    if (record.proofData) {
      var view = el('div', 'admin-proof__view');
      var url = objectUrlFor(record.proofData);
      if ((record.proofType || '').indexOf('image/') === 0) {
        var img = document.createElement('img');
        img.src = url;
        img.alt = 'Preuve de paiement transmise par ' + record.client;
        view.appendChild(img);
      } else {
        var frame = document.createElement('iframe');
        frame.src = url;
        frame.title = 'Preuve de paiement transmise par ' + record.client;
        view.appendChild(frame);
      }
      proofCol.appendChild(view);

      var dl = el('button', 'admin-proof__download', 'Télécharger le fichier');
      dl.type = 'button';
      dl.addEventListener('click', function () { downloadProof(record); });
      proofCol.appendChild(dl);
    } else if (record.proofTruncated) {
      proofCol.appendChild(el('p', 'admin-proof__missing',
        'Fichier trop volumineux pour le stockage local : il n\'est visible que depuis l\'appareil où la demande a été envoyée.'));
    } else {
      proofCol.appendChild(el('p', 'admin-proof__missing', 'Aucun fichier transmis.'));
    }
    cols.appendChild(proofCol);
    card.appendChild(cols);

    /* Décision */
    var decide = el('div', 'admin-decide');

    if (record.status === 'pending') {
      var label = el('label', 'admin-decide__label');
      label.setAttribute('for', 'msg-' + record.dossier);
      label.appendChild(document.createTextNode('Message au client '));
      label.appendChild(el('span', 'admin-decide__req', '— obligatoire en cas de rejet'));
      decide.appendChild(label);

      var textarea = document.createElement('textarea');
      textarea.id = 'msg-' + record.dossier;
      textarea.rows = 3;
      textarea.placeholder = 'Ex. : Paiement bien reçu, votre formation démarre la semaine prochaine. / La preuve envoyée est illisible, merci de renvoyer le reçu complet.';
      textarea.value = state.adminMsg[record.dossier] || '';
      textarea.addEventListener('input', function () {
        state.adminMsg[record.dossier] = textarea.value;
      });
      decide.appendChild(textarea);

      var actions = el('div', 'admin-decide__actions');
      var approve = el('button', 'btn-approve', 'Valider le paiement');
      approve.type = 'button';
      approve.addEventListener('click', function () { decide_(record.dossier, 'approved'); });
      var reject = el('button', 'btn-reject', 'Rejeter la preuve');
      reject.type = 'button';
      reject.addEventListener('click', function () { decide_(record.dossier, 'rejected'); });
      var error = el('span', 'admin-decide__error');
      error.setAttribute('data-decide-error', '');
      error.setAttribute('role', 'alert');
      actions.appendChild(approve);
      actions.appendChild(reject);
      actions.appendChild(error);
      decide.appendChild(actions);
    } else {
      decide.appendChild(el('p', 'admin-locked', record.status === 'approved'
        ? 'Dossier validé — aucune nouvelle décision possible tant que le client n\'a pas transmis une nouvelle preuve.'
        : 'Preuve rejetée — en attente d\'une nouvelle preuve de paiement du client.'));
    }

    if (record.history && record.history.length) {
      decide.appendChild(el('p', 'admin-history', 'Historique : ' + record.history.map(function (h) {
        return (h.status === 'approved' ? 'Validé' : 'Rejeté') + ' le ' + h.at + ' — ' + h.note;
      }).join(' · ')));
    }

    if (record.decidedAt) {
      var box = el('div', 'note-box admin-decision note-box--' + status.cls);
      box.appendChild(el('p', 'note-box__title', 'Décision transmise au client · ' + record.decidedAt));
      box.appendChild(el('p', 'note-box__body', record.note));
      decide.appendChild(box);
    }

    card.appendChild(decide);
    return card;
  }

  /* Nom volontairement suffixé : « decide » seul entrerait en collision avec
     le mot-clé réservé d'anciens moteurs. */
  function decide_(dossier, status) {
    var record = findRecord(dossier);
    if (!record || record.status !== 'pending') return;

    var message = (state.adminMsg[dossier] || '').trim();
    if (status === 'rejected' && !message) {
      var card = $('.admin-card[data-dossier="' + CSS.escape(dossier) + '"]', refs.adminList);
      var slot = card && $('[data-decide-error]', card);
      if (slot) slot.textContent = 'Indiquez la raison du rejet avant de rejeter.';
      return;
    }

    var fallback = status === 'approved'
      ? 'Votre paiement a été vérifié et validé. Un conseiller vous contacte pour planifier votre formation.'
      : 'Votre preuve de paiement n\'a pas pu être validée.';

    delete state.adminMsg[dossier];

    saveRecords(state.records.map(function (r) {
      if (r.dossier !== dossier) return r;
      return Object.assign({}, r, {
        status: status,
        decidedAt: nowDateTime(),
        note: message || fallback,
        resubmittedAt: ''
      });
    }));

    renderAdmin();
  }

  /* ========================================================================
     11. Facture
     ======================================================================== */

  function invoiceHtml() {
    var permit = currentPermit();
    var method = currentMethod();
    var price = permit ? permit.price : 0;
    var invoiceNo = state.dossier.replace('PE-', 'FA-');

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
      '<div style="margin-top:10px;font-size:12px;color:#5A5F6E">' + esc(SITE.contact.phone) + '<br>' + esc(SITE.contact.legal) + '</div></div>' +
      '<div style="text-align:right"><div style="font-size:18px;font-weight:700">FACTURE</div>' +
      '<div style="font-family:monospace;margin-top:6px">' + esc(invoiceNo) + '</div>' +
      '<div style="color:#8B90A0">' + esc(state.invoiceDate) + '</div>' +
      '<div style="color:#8B90A0">Dossier ' + esc(state.dossier) + '</div></div></div><div class="band"></div>' +
      '<div class="box"><div class="lbl">Client</div><table>' +
      row('Nom et prénom', (form.prenom + ' ' + form.nom).trim() || '—') +
      row('Adresse', form.adresse || '—') +
      row('Ville', form.ville || '—') +
      row('Pays', form.pays || '—') +
      row('Téléphone', form.tel || '—') +
      row('E-mail', form.email || '—') +
      row('Date de naissance', frDate(form.naissance) || '—') +
      '</table></div>' +
      '<div class="box"><div class="lbl">Détail de la commande</div><table><thead><tr>' +
      '<th style="text-align:left;border-bottom:1px solid #E6E7EC;padding-bottom:8px;font-size:11px;color:#8B90A0;text-transform:uppercase">Prestation</th>' +
      '<th style="text-align:right;border-bottom:1px solid #E6E7EC;padding-bottom:8px;font-size:11px;color:#8B90A0;text-transform:uppercase">Montant</th>' +
      '</tr></thead><tbody>' +
      '<tr><td style="padding:12px 0">' + esc(permit ? permit.name : '—') + ' — accompagnement complet</td>' +
      '<td style="padding:12px 0;text-align:right">' + price + ' €</td></tr>' +
      '<tr><td style="padding:12px 0;border-top:1px solid #E6E7EC;font-weight:700">Total à régler</td>' +
      '<td style="padding:12px 0;border-top:1px solid #E6E7EC;text-align:right;font-weight:700;font-size:18px">' + price + ' €</td></tr>' +
      '</tbody></table></div>' +
      '<div class="box"><div class="lbl">Paiement</div><table>' +
      row('Moyen de paiement', method ? method.name : '—') +
      row('Preuve transmise', state.proof.name || '—') +
      (state.wuRef ? row('Référence transfert (MTCN)', state.wuRef) : '') +
      row('Statut', payStatusLabel()) +
      '</table><div style="margin-top:12px;font-size:12px;color:#5A5F6E">Ce document confirme l\'enregistrement de votre commande. ' +
      'Il ne vaut pas quittance : le paiement sera vérifié par notre équipe, qui vous adressera la confirmation définitive.</div></div>' +
      '<div style="font-size:11px;color:#8B90A0;margin-top:20px">' + esc(SITE.invoiceLegal) + '</div>' +
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
      openFunnel(state.permit ? 2 : 1);
    },
    choose: function (btn) {
      state.permit = btn.getAttribute('data-permit');
      clearFormErrors();
      openFunnel(2);
    },
    'pick-permit': function (btn) {
      state.permit = btn.getAttribute('data-permit');
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
      // Un MTCN ne concerne que Western Union : on l'oublie si on en change.
      if (state.method !== 'wu') {
        state.wuRef = '';
        if (refs.mtcn) refs.mtcn.value = '';
      }
      renderFunnel();
    },
    declare: function () {
      state.declared = !state.declared;
      renderFunnel();
    },
    confirm: function () { confirmRequest(); },
    invoice: function () { printInvoice(); },
    'funnel-close': function () { closeFunnel(); },

    track: function () {
      closeMobileNav();
      syncRecords();
      refs.trackError.textContent = '';
      state.trackFound = null;
      show(refs.trackResult, false);
      openOverlay(refs.track, refs.trackInput);
    },
    'track-close': function () { closeOverlay(refs.track); },
    'track-run': function () { runTrack(); },
    'track-retry': function () { trackRetry(); },

    admin: function () { openAdmin(); },
    'admin-close': function () { closeAdmin(); },
    'admin-login': function () { adminLogin(); },

    copy: function (btn) {
      var key = btn.getAttribute('data-copy');
      var values = {
        holder: SITE.bank.holder,
        iban: SITE.bank.iban,
        bic: SITE.bank.bic,
        ref: payRef()
      };
      copyValue(btn, values[key] || '');
    }
  };

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

    if (refs.mtcn) {
      refs.mtcn.addEventListener('input', function () { state.wuRef = refs.mtcn.value; });
    }

    refs.trackInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runTrack(); }
    });

    refs.adminPass.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); adminLogin(); }
    });
    refs.adminPass.addEventListener('input', function () { refs.adminError.textContent = ''; });

    $$('[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.adminFilter = btn.getAttribute('data-filter');
        renderAdmin();
      });
    });

    // Les dossiers peuvent être modifiés dans un autre onglet.
    window.addEventListener('storage', function (e) {
      if (e.key !== STORE_KEY) return;
      syncRecords();
      if (state.adminAuth && !refs.admin.hidden) renderAdmin();
    });
  }

  /* ========================================================================
     14. Cohérence du catalogue
     ======================================================================== */

  function checkCatalogue() {
    $$('#tarifsGrid [data-permit]').forEach(function (card) {
      var id = card.getAttribute('data-permit');
      var price = card.getAttribute('data-price');
      if (!price) return;
      var permit = permitById(id);
      if (!permit) {
        console.warn('[Permis Express] Tarif « ' + id +' » absent de PERMITS (app.js).');
      } else if (String(permit.price) !== price) {
        console.warn('[Permis Express] Prix divergent pour « ' + id + ' » : ' +
          price + ' € dans index.html, ' + permit.price + ' € dans app.js.');
      }
    });
  }

  /* ========================================================================
     15. Démarrage
     ======================================================================== */

  function init() {
    collectRefs();

    show(refs.promoBar, SITE.promoBar);
    show(refs.gallery, SITE.gallery);

    $('#bankHolder').textContent = SITE.bank.holder;
    $('#bankIban').textContent = SITE.bank.iban;
    $('#bankBic').textContent = SITE.bank.bic;
    $('#wuName').textContent = SITE.westernUnion.beneficiary;
    $('#wuCity').textContent = SITE.westernUnion.city;
    show($('#bankTodo'), !SITE.bank.complete);
    show($('#wuTodo'), !SITE.westernUnion.complete);

    buildPermitGrid();
    state.records = readStore();
    fillForm();
    wire();
    renderFunnel();
    checkCatalogue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
