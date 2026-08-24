# Permis Express

Site vitrine et parcours d'inscription en ligne de **Permis Express** —
« Votre permis, notre priorité ».

Une seule page, sans étape de build : ouvrir `index.html` suffit, et le
déploiement statique (Vercel, Netlify, tout hébergeur de fichiers) fonctionne
sans configuration.

## Ce que fait le site

**Vitrine** — héro, « Pourquoi nous », tarifs (8 catégories), notre méthode,
suivi de dossier, avis clients, FAQ, pied de page.

**Parcours d'inscription intégré**, en surcouche plein écran :

1. choix du permis ;
2. informations personnelles, avec validation ;
3. récapitulatif à vérifier avant tout paiement ;
4. paiement — virement bancaire, Wero ou Western Union — avec **preuve de
   paiement obligatoire** ;
5. confirmation : numéro de dossier, statut, prochaines étapes et facture
   téléchargeable en PDF.

**Suivi de dossier** — le client saisit son numéro de dossier et consulte le
statut de son paiement ainsi que le message rédigé par l'équipe. Si sa preuve a
été rejetée, un bouton le ramène directement à l'étape paiement pour en
renvoyer une nouvelle.

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
index.html            Page complète (vitrine + surcouches parcours / admin / suivi)
styles.css            Feuille de styles unique
app.js                Logique : parcours, stockage, admin, suivi, facture
assets/
  logo.png            Logo (512×512)
  favicon.png         Icône d'onglet
  apple-touch-icon.png
  fonts.css           Déclarations @font-face
  fonts/              Archivo + Instrument Sans (woff2, auto-hébergées)
qa/parcours.mjs       Suite de tests de bout en bout (Playwright)
```

Les polices sont **auto-hébergées** : la page n'émet aucune requête vers un
domaine tiers. C'est plus rapide, et cela évite de transmettre l'adresse IP des
visiteurs à Google — un point sensible pour un site commercial français.

## À compléter avant la mise en ligne

Tout est regroupé en haut de `app.js`, dans l'objet `SITE` :

| Élément | Où | Statut |
|---|---|---|
| Coordonnées bancaires (titulaire, IBAN, BIC) | `SITE.bank` | **à fournir** |
| Bénéficiaire et ville Western Union | `SITE.westernUnion` | **à fournir** |
| Mentions société sur la facture (SIRET, TVA, adresse) | `SITE.invoiceLegal` | **à fournir** |
| Code d'accès administrateur | `SITE.adminCode` | défini (voir limites) |

Une fois les vraies coordonnées saisies, passer `SITE.bank.complete` et
`SITE.westernUnion.complete` à `true` : les encadrés orange « à compléter »
disparaissent.

Également dans `index.html` : remplacer `https://exemple.fr` par le domaine
réel dans les balises `canonical`, `og:url` et `og:image`.

Deux interrupteurs d'affichage, toujours dans `SITE` :

- `promoBar` — le bandeau en haut de page ;
- `gallery` — la section « En images », désactivée faute de photos réelles.
  Remplacer les blocs `.gallery-ph` de `index.html` par de vraies `<img>`, puis
  passer le drapeau à `true`.

Les tarifs figurent à deux endroits : dans `PERMITS` (`app.js`), qui alimente le
parcours, le récapitulatif et la facture, et en HTML statique dans la section
Tarifs, pour le référencement. `checkCatalogue()` compare les deux au
chargement et signale toute divergence dans la console.

## Limites connues

Ces points demandent un serveur ; ils sont volontairement laissés en l'état
plutôt que simulés.

- **Les dossiers sont stockés dans le navigateur** (`localStorage`). L'espace
  administrateur ne voit donc que les demandes envoyées **depuis le même
  appareil et le même navigateur**. Un véritable back-office suppose une base
  de données et une API. Le point d'entrée à remplacer est `saveRecords()` /
  `readStore()` dans `app.js`.
- **Le code d'accès administrateur est dans le code de la page**, donc lisible
  par n'importe quel visiteur. C'est une protection de façade, acceptable pour
  une démonstration seulement : une vraie authentification doit se faire côté
  serveur.
- **Aucun e-mail n'est envoyé.** Le client est informé via « Suivre ma
  demande ». L'envoi automatique demande un service côté serveur.
- **Wero n'est pas raccordé.** L'interface est prête ; la fonction
  `startWeroPayment()` dans `app.js` marque l'endroit où brancher l'API ou le
  lien de paiement officiel. En attendant, le site annonce clairement qu'un
  conseiller enverra un lien de paiement.
- Si une preuve de paiement dépasse le quota du navigateur, le dossier est
  malgré tout conservé, sans le fichier ; l'espace administrateur l'indique.

## Développement

Aucune dépendance, aucun build. Pour un aperçu local :

```sh
python3 -m http.server 8000     # puis http://localhost:8000
```

Ouvrir `index.html` directement depuis le disque fonctionne aussi.

### Tests

`qa/parcours.mjs` couvre le parcours complet, la validation du formulaire, les
trois moyens de paiement, la preuve obligatoire, l'espace administrateur, le
suivi, le renvoi d'une preuve, l'accessibilité clavier et le rendu mobile,
tablette et bureau (100 assertions).

```sh
npm install --no-save playwright && npx playwright install chromium
node qa/parcours.mjs
```
