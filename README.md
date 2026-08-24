# Permis Express

Site vitrine et parcours d'inscription en ligne de **Permis Express** —
« Votre permis, notre priorité ».

Site statique et fonctions serverless, sans étape de build. Les dossiers et les
preuves de paiement sont stockés côté serveur (Supabase) ; l'espace
administrateur est protégé par une authentification serveur.

## Ce que fait le site

**Vitrine** — héro, « Pourquoi nous », tarifs (8 catégories), notre méthode,
« Comment ça marche ? » (volet déroulant), attestation d'activité, suivi de
dossier, avis clients, FAQ, pied de page. Un **bouton WhatsApp flottant** ouvre
une conversation avec le numéro de l'agence ; c'est un lien simple, qui
fonctionne même si `app.js` ne se charge pas, et il s'efface pendant que le
parcours d'inscription est ouvert.

**Parcours d'inscription intégré**, en surcouche plein écran :

1. choix du permis ;
2. informations personnelles, avec validation — dont une **photo d'identité**
   (obligatoire) et le **numéro NEPH** (facultatif : un candidat qui passe son
   premier permis n'en a pas encore) ;
3. récapitulatif à vérifier avant tout paiement ;
4. paiement par virement bancaire, avec **preuve de paiement obligatoire** ;
5. confirmation : numéro de dossier, statut, prochaines étapes et facture
   téléchargeable en PDF.

**Suivi de dossier** — le client saisit son numéro de dossier **et l'adresse
e-mail de sa demande**, puis consulte le statut de son paiement et le message
rédigé par l'équipe. Si sa preuve a été rejetée, un bouton le ramène
directement à l'étape paiement pour en renvoyer une nouvelle.

**Espace administrateur** (lien en bas de page), deux onglets :

- **Demandes** — liste des dossiers, coordonnées du client, photo d'identité,
  numéro NEPH, aperçu de la preuve (image affichée, PDF lisible dans un lecteur
  intégré, téléchargement), filtres par statut, et validation ou rejet avec un
  message transmis au client. Le message est **obligatoire pour rejeter**.
  Après décision, le dossier est verrouillé jusqu'à ce que le client renvoie une
  nouvelle preuve ; la décision précédente est archivée dans un historique.
- **Réglages** — le compte qui reçoit les virements (titulaire, IBAN, BIC, RIB,
  référence à indiquer), modifiable depuis le navigateur, sans toucher au code.

Le site ne prétend jamais qu'un paiement a été encaissé. Il distingue trois
états : *paiement à effectuer*, *paiement en attente de vérification* et
*preuve envoyée — en attente de vérification*. La validation reste manuelle.

## Structure

```
index.html               Page complète (vitrine + surcouches)
styles.css               Feuille de styles unique
app.js                   Logique de la page — ne contient aucun secret
assets/                  Logo, icônes, polices auto-hébergées

api/                     Fonctions serverless (Node, sans dépendance)
  _lib/
    catalogue.js         Formations et prix — source de vérité
    parametres.js        Compte bancaire : valeur par défaut, lecture, contrôle
    validation.js        Clés de contrôle : IBAN, BIC, NEPH
    supabase.js          Accès base et stockage via l'API REST
    auth.js              Empreinte du code admin, cookies de session, jetons
    http.js              Utilitaires de requête et de réponse
  catalogue.js           GET  — formations, moyens de paiement, coordonnées
  diagnostic.js          GET  — page de contrôle de la configuration
  preuve-url.js          POST — URL de dépôt signée (preuve ou photo)
  dossiers.js            POST — création d'une demande / renvoi de preuve
  suivi.js               POST — consultation par le client (numéro + e-mail)
  admin/
    login.js             POST — connexion (empreinte scrypt + session)
    session.js           GET  — session en cours ?  DELETE — déconnexion
    dossiers.js          GET  — liste des demandes
    decision.js          POST — validation / rejet
    preuve.js            GET  — sert la preuve ou la photo (?piece=)
    parametres.js        GET / POST — coordonnées bancaires

supabase/
  schema.sql             Installation neuve : tables, index, RLS, buckets
  2026-08-parametres-et-photos.sql   Mise à jour d'une base déjà installée
scripts/                 Outils : code admin, vérifications
qa/                      Suite de tests de bout en bout
```

Onze fonctions serverless : l'offre gratuite de Vercel en autorise douze. C'est
pourquoi la déconnexion est un `DELETE` sur `admin/session` plutôt qu'un
fichier séparé.

Les polices sont **auto-hébergées** : la page n'émet aucune requête vers un
domaine tiers. C'est plus rapide, et cela évite de transmettre l'adresse IP des
visiteurs à Google — un point sensible pour un site commercial français.

---

## Mise en service

### 1. Créer le projet Supabase

Sur [supabase.com](https://supabase.com), créer un projet (l'offre gratuite
suffit largement : 500 Mo de base, 1 Go de fichiers). Choisir une région
européenne — les dossiers contiennent des données personnelles.

Puis **SQL Editor → New query**, coller le contenu de `supabase/schema.sql` et
l'exécuter. Cela crée les tables, active le verrouillage des accès et crée les
buckets privés `preuves` et `photos`.

> **Base déjà installée avant août 2026 ?** Exécuter dans le même éditeur
> `supabase/2026-08-parametres-et-photos.sql` : il ajoute la table des
> réglages, les colonnes NEPH et photo, et le bucket `photos`. Le script peut
> être relancé sans dommage, et ne touche à aucune donnée existante. Tant
> qu'il n'est pas passé, l'onglet **Réglages** et le dépôt de photo échouent.

### 2. Générer le code d'accès administrateur

```sh
npm run code-admin
```

Le script demande un code (12 caractères minimum) et affiche deux valeurs à
reporter dans les variables d'environnement. **Le code lui-même n'est stocké
nulle part** : seule son empreinte scrypt l'est. Conservez-le de votre côté.

> L'ancien code de la version sans serveur (`#Capaciteur200K#`) figure dans
> l'historique public de ce dépôt : **il ne doit plus être réutilisé.**
> Choisissez-en un nouveau.

### 3. Renseigner les variables d'environnement

Dans Vercel : **Project → Settings → Environment Variables**. Voir
`.env.example` pour la liste commentée.

| Variable | Où la trouver |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → Data API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → `service_role` |
| `ADMIN_PASSWORD_HASH` | affiché par `npm run code-admin` |
| `SESSION_SECRET` | affiché par `npm run code-admin` |

La clé `service_role` contourne toutes les règles d'accès de la base. Elle
n'est lue que par les fonctions serverless et ne doit jamais être exposée au
navigateur ni committée.

### 4. Vérifier que tout répond

Ouvrez **`https://votre-site/api/diagnostic`** dans un navigateur. La page
contrôle chaque condition dans l'ordre — variables d'environnement, tables,
bucket — et effectue un aller-retour complet sur le stockage : demande d'URL
signée, dépôt, relecture, suppression. Pour chaque point en échec, elle indique
la marche à suivre. Aucun secret n'y figure.

Depuis un terminal, l'équivalent plus détaillé :

```sh
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run verifier
```

### Changer les coordonnées bancaires

Depuis le site lui-même, sans toucher au code : **espace administrateur →
onglet Réglages**. Modifier le titulaire, l'IBAN, le BIC, le RIB ou la
référence, puis *Enregistrer*. Le changement est immédiat pour les clients
suivants — aucun redéploiement n'est nécessaire.

Trois garde-fous rendent l'opération sûre :

- **L'IBAN et le BIC sont vérifiés avant l'enregistrement**, par le serveur et
  non seulement par le navigateur : clé de contrôle mod 97 pour l'IBAN, format
  SWIFT pour le BIC. Une saisie fautive est refusée, et l'ancien compte reste
  en place.
- **Si l'enregistrement échoue ou si la base est injoignable**, le site retombe
  sur les coordonnées inscrites dans `api/_lib/parametres.js` — il n'affiche
  jamais un panneau de virement vide ou incomplet.
- **Si les coordonnées affichées ne passent pas le contrôle d'IBAN**, la page
  n'affiche **aucun** compte et invite le client à téléphoner : un paiement
  retardé vaut mieux qu'un virement envoyé sur un compte inexistant.

Pour vérifier : cliquer *Commencer ma demande* et aller jusqu'à l'étape de
paiement ; les nouvelles coordonnées doivent s'y afficher.

### Mentions de la facture

`SITE.company` porte l'adresse imprimée sur la facture. `siret` et `tva` sont
volontairement vides : l'exploitant communique ces informations au client par
un autre canal. Le support reste en place — renseigner l'un ou l'autre le fait
apparaître au bas de la facture.

Chacun porte une clé de contrôle, vérifiée au chargement : clé de Luhn pour le
SIRET, sur le SIREN comme sur les quatorze chiffres, et pour la TVA
`(12 + 3 × (SIREN mod 97)) mod 97`, qui doit aussi correspondre au SIREN du
SIRET. Un identifiant invalide n'est jamais imprimé — il est écarté, et un
avertissement part en console. Une facture ne peut donc pas porter un numéro
inexact.

> À noter : en France, une facture doit légalement mentionner le numéro SIREN
> ou SIRET de l'émetteur, et le numéro de TVA intracommunautaire dès lors que
> l'entreprise y est assujettie. Les laisser vides est un choix de l'exploitant.

### Référence de virement

La référence est le libellé que le client reporte sur son virement. Elle se
modifie dans l'onglet **Réglages**, à côté des coordonnées. Elle est identique
pour tous : le rapprochement d'un virement avec un dossier repose sur la preuve
de paiement jointe, pas sur le libellé bancaire.

### Attestation d'activité

La section `#attestation` affiche le document de l'auto-école, déposé dans
`assets/` sous le nom `attestation`. L'extension est libre — `.jpg`, `.jpeg`,
`.png` ou `.webp` : `app.js` essaie ces quatre noms et garde le premier qui
répond, pour que l'exploitant n'ait pas à renommer le fichier sorti de son
téléphone. Si aucun ne répond, la section reste masquée : une page sans
document ne montre ni cadre vide ni image cassée.

Pour remplacer le document depuis GitHub, sans rien installer : ouvrir le
dossier `assets`, **Add file → Upload files**, déposer l'image nommée
`attestation`, puis **Commit changes**. Vercel redéploie tout seul. Si
l'ancienne version portait une autre extension, la supprimer — sinon c'est
elle qui reste affichée, `.jpg` passant avant `.png`.

### Numéro WhatsApp

Il apparaît à trois endroits d'`index.html`, sous la forme
`https://wa.me/33676326199?text=…` : le bouton flottant en bas de page, le lien
du volet « Comment ça marche ? » et celui du pied de page. Le format `wa.me`
attend l'indicatif pays sans `+` ni espaces. Le texte après `?text=` est le
message pré-rempli dans la conversation, encodé pour l'URL.

### Divers

Dans `index.html` : remplacer `https://exemple.fr` par le domaine
réel dans les balises `canonical`, `og:url` et `og:image`.

Deux interrupteurs d'affichage, toujours dans `SITE` :

- `promoBar` — le bandeau en haut de page ;
- `gallery` — la section « En images », désactivée faute de photos réelles.

---

## Comment les accès sont protégés

- **Aucun secret dans la page.** `app.js` ne contient ni code d'accès, ni clé
  d'API. Le code administrateur est vérifié par `/api/admin/login` à partir de
  son empreinte scrypt ; une comparaison à temps constant évite de laisser
  fuiter l'information par le temps de réponse.
- **Session par cookie signé** — `HttpOnly` (inaccessible au JavaScript),
  `Secure`, `SameSite=Strict` (pas d'envoi depuis un autre site), 8 heures.
- **Tentatives limitées** — dix échecs depuis une même adresse IP bloquent la
  connexion quinze minutes.
- **Base verrouillée** — RLS activé sans aucune policy : seules les fonctions
  serverless, qui utilisent la clé `service_role`, accèdent aux données.
- **Preuves et photos dans des buckets privés** — aucun fichier n'a d'URL
  publique. Le dépôt passe par une URL signée à usage unique dont le chemin est
  choisi par le serveur ; la lecture passe par `/api/admin/preuve`, derrière la
  session. Le jeton remis au navigateur scelle le bucket autant que le chemin :
  une photo ne peut pas être présentée comme une preuve de paiement, ni
  l'inverse.
- **Les coordonnées bancaires sont revérifiées par le serveur** avant d'être
  enregistrées, et l'onglet Réglages est derrière la même session que le reste
  de l'espace administrateur.
- **Le suivi client exige numéro + e-mail.** Le numéro seul ne suffit pas :
  sinon, essayer des numéros au hasard révélerait le nom et le montant d'autres
  clients. La réponse est la même que le dossier n'existe pas ou que l'e-mail ne
  corresponde pas — rien ne permet de deviner quels numéros existent.
- **Le montant vient du serveur.** Le navigateur envoie un identifiant de
  formation, jamais un prix.
- **Le verrouillage après décision est appliqué côté serveur**, pas seulement
  par l'affichage.

## En cas de problème

Le parcours affiche « Une erreur est survenue » quand une fonction serveur
échoue : le détail est volontairement masqué au visiteur. Pour savoir ce qui
se passe, ouvrez **`/api/diagnostic`**. Après toute modification des variables
d'environnement, redéployez : Vercel ne les recharge qu'au déploiement suivant.

## Limites connues

- **Aucun e-mail n'est envoyé.** Le client est informé via « Suivre ma
  demande ». Le point d'intégration est marqué dans `api/admin/decision.js`.
- **Un seul moyen de paiement : le virement bancaire.** Wero et Western Union
  ont été retirés faute de coordonnées d'encaissement — proposer un règlement
  qui n'aboutit pas est pire que ne pas le proposer. Pour en rétablir un,
  remettez-le dans `MOYENS` (`api/_lib/catalogue.js`) et rajoutez son panneau
  dans `index.html` ; la colonne `reference_wu` et l'affichage du MTCN côté
  administrateur sont conservés pour les dossiers déjà enregistrés.
- **Pas de purge automatique.** Un client qui abandonne après avoir déposé sa
  photo ou sa preuve, sans valider, laisse un fichier orphelin. Sans
  conséquence fonctionnelle, mais un nettoyage périodique serait utile.
- **Un seul compte administrateur**, sans traçabilité des décisions par
  utilisateur. Suffisant pour une équipe réduite ; à faire évoluer au-delà.

---

## Développement

Aucune dépendance à installer pour faire tourner le site. Pour un aperçu local
de la seule vitrine :

```sh
python3 -m http.server 8000     # http://localhost:8000
```

Le parcours d'inscription a besoin des fonctions serverless : utiliser le banc
d'essai des tests (ci-dessous) ou `vercel dev`.

### Tests

`qa/parcours.mjs` démarre `qa/serveur-test.mjs` — le site, les **vraies**
fonctions serverless, et un faux Supabase qui rejoue la portion de son API REST
que le code utilise — puis déroule le parcours complet dans un navigateur :
212 assertions couvrant la vitrine, le bouton WhatsApp, l'attestation, la validation, la photo d'identité et le
NEPH, le virement, la preuve obligatoire, l'espace administrateur, l'onglet
Réglages, le suivi, le renvoi de preuve, les contrôles d'accès de l'API,
l'accessibilité clavier, le rendu mobile/tablette/bureau, le repli sur un IBAN
invalide et celui si l'API est injoignable.

```sh
npm install --no-save playwright && npx playwright install chromium
npm test
```

Le faux Supabase valide que **notre** code appelle Supabase de façon cohérente,
pas que nos hypothèses sur Supabase sont exactes : c'est `npm run verifier`,
lancé contre un vrai projet, qui le confirme.

```sh
npm run verifier-catalogue   # les prix de index.html correspondent-ils au catalogue serveur ?
```
