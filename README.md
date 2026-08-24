# Permis Express

Site vitrine et parcours d'inscription en ligne de **Permis Express** —
« Votre permis, notre priorité ».

Site statique et fonctions serverless, sans étape de build. Les dossiers et les
preuves de paiement sont stockés côté serveur (Supabase) ; l'espace
administrateur est protégé par une authentification serveur.

## Ce que fait le site

**Vitrine** — héro, « Pourquoi nous », tarifs (8 catégories), notre méthode,
suivi de dossier, avis clients, FAQ, pied de page.

**Parcours d'inscription intégré**, en surcouche plein écran :

1. choix du permis ;
2. informations personnelles, avec validation ;
3. récapitulatif à vérifier avant tout paiement ;
4. paiement par virement bancaire, avec **preuve de paiement obligatoire** ;
5. confirmation : numéro de dossier, statut, prochaines étapes et facture
   téléchargeable en PDF.

**Suivi de dossier** — le client saisit son numéro de dossier **et l'adresse
e-mail de sa demande**, puis consulte le statut de son paiement et le message
rédigé par l'équipe. Si sa preuve a été rejetée, un bouton le ramène
directement à l'étape paiement pour en renvoyer une nouvelle.

**Espace administrateur** (lien en bas de page) — liste des demandes,
coordonnées du client, aperçu de la preuve (image affichée, PDF lisible dans un
lecteur intégré, téléchargement), filtres par statut, et validation ou rejet
avec un message transmis au client. Le message est **obligatoire pour rejeter**.
Après décision, le dossier est verrouillé jusqu'à ce que le client renvoie une
nouvelle preuve ; la décision précédente est archivée dans un historique.

Le site ne prétend jamais qu'un paiement a été encaissé. Il distingue trois
états : *paiement à effectuer*, *paiement en attente de vérification* et
*preuve envoyée — en attente de vérification*. La validation reste manuelle.

## Structure

```
index.html               Page complète (vitrine + surcouches)
coordonnees-bancaires.js Compte qui reçoit les virements — voir ci-dessous
styles.css               Feuille de styles unique
app.js                   Logique de la page — ne contient aucun secret
assets/                  Logo, icônes, polices auto-hébergées

api/                     Fonctions serverless (Node, sans dépendance)
  _lib/
    catalogue.js         Formations et prix — source de vérité
    supabase.js          Accès base et stockage via l'API REST
    auth.js              Empreinte du code admin, cookies de session, jetons
    http.js              Utilitaires de requête et de réponse
  catalogue.js           GET  — formations et moyens de paiement
  diagnostic.js          GET  — page de contrôle de la configuration
  preuve-url.js          POST — URL de dépôt signée pour la preuve
  dossiers.js            POST — création d'une demande / renvoi de preuve
  suivi.js               POST — consultation par le client (numéro + e-mail)
  admin/
    login.js             POST — connexion (empreinte scrypt + session)
    logout.js            POST
    session.js           GET  — session en cours ?
    dossiers.js          GET  — liste des demandes
    decision.js          POST — validation / rejet
    preuve.js            GET  — sert le fichier de preuve

supabase/schema.sql      Tables, index, RLS et bucket — à exécuter une fois
scripts/                 Outils : code admin, vérifications
qa/                      Suite de tests de bout en bout
```

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
l'exécuter. Cela crée les tables, active le verrouillage des accès et crée le
bucket privé `preuves`.

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

### 5. Compléter les informations commerciales

En haut de `app.js`, dans l'objet `SITE` :

| Élément | Où | Statut |
|---|---|---|
| Coordonnées bancaires | `coordonnees-bancaires.js` | renseignées |

### Changer les coordonnées bancaires

Tout est dans **`coordonnees-bancaires.js`**, à la racine du dépôt : une
douzaine de lignes, isolées exprès du reste du code pour pouvoir être modifiées
sans risque et sans outil.

Depuis GitHub, sans rien installer :

1. ouvrir le dépôt, cliquer sur `coordonnees-bancaires.js` ;
2. cliquer sur l'icône crayon (**Edit this file**) ;
3. modifier ce qui est **entre les guillemets**, sans toucher aux guillemets,
   aux virgules ni aux accolades ;
4. cliquer **Commit changes**, puis à nouveau **Commit changes** ;
5. attendre une minute : Vercel redéploie tout seul.

Deux garde-fous rendent l'opération sûre :

- **L'IBAN est vérifié au chargement** par sa clé de contrôle, qui détecte
  quasiment toute faute de frappe. S'il ne passe pas, le site n'affiche
  **aucune** coordonnée et invite le client à téléphoner — un paiement retardé
  vaut mieux qu'un virement envoyé sur un compte inexistant. Un avertissement
  est écrit en console.
- **Une erreur de syntaxe dans le fichier ne casse pas le site.** Le navigateur
  ignore alors le fichier, `app.js` s'en aperçoit et la page continue de
  fonctionner ; seul le panneau de virement affiche le message ci-dessus.

Après modification, ouvrir la page, cliquer *Commencer ma demande* et aller
jusqu'à l'étape de paiement : si les nouvelles coordonnées s'affichent, c'est
bon. Sinon, le message renvoyant au téléphone signale une faute de frappe.

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

`SITE.referenceVirement` est le libellé que le client reporte sur son virement.
Il est identique pour tous : le rapprochement d'un virement avec un dossier
repose sur la preuve de paiement jointe, pas sur le libellé bancaire.

Également dans `index.html` : remplacer `https://exemple.fr` par le domaine
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
- **Preuves dans un bucket privé** — aucun fichier n'a d'URL publique. Le dépôt
  passe par une URL signée à usage unique dont le chemin est choisi par le
  serveur ; la lecture passe par `/api/admin/preuve`, derrière la session.
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
  preuve, sans valider, laisse un fichier orphelin dans le bucket. Sans
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
119 assertions couvrant la vitrine, la validation, les trois moyens de
paiement, la preuve obligatoire, l'espace administrateur, le suivi, le renvoi
de preuve, les contrôles d'accès de l'API, l'accessibilité clavier, le rendu
mobile/tablette/bureau et le repli si l'API est injoignable.

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
