/* Banc d'essai local — voir README.md § Tests.

   Démarre deux serveurs :

   1. le site et ses fonctions serverless, en appelant les VRAIS gestionnaires
      de api/ (adaptés à la signature Vercel : req.body, req.query, res.status) ;
   2. un faux Supabase qui rejoue la portion de l'API REST (PostgREST) et de
      l'API Storage dont api/_lib/supabase.js se sert réellement.

   Le second point mérite une mise en garde : ce double valide que notre code
   appelle Supabase de façon cohérente, PAS que nos hypothèses sur Supabase
   sont exactes. La vérification contre un vrai projet se fait avec
   `node scripts/verifier-supabase.mjs`. */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json'
};

/* ==========================================================================
   1. Faux Supabase
   ========================================================================== */

function demarrerFauxSupabase() {
  const dossiers = [];              // lignes de la table « dossiers »
  const tentatives = new Map();     // table « admin_tentatives »
  const fichiers = new Map();       // bucket « preuves »
  const jetonsDepot = new Map();    // URL de téléversement signées

  const lire = (req) => new Promise((resoudre) => {
    const morceaux = [];
    req.on('data', (c) => morceaux.push(c));
    req.on('end', () => resoudre(Buffer.concat(morceaux)));
  });

  const envoyerJson = (res, code, corps) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(corps));
  };

  /* Extrait la valeur d'un filtre PostgREST du type ?colonne=eq.valeur */
  const eq = (params, colonne) => {
    const v = params.get(colonne);
    return v && v.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : null;
  };

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://interne');
    const chemin = url.pathname;
    const params = url.searchParams;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*'
      });
      return res.end();
    }

    /* ---- Table dossiers ---- */
    if (chemin === '/rest/v1/dossiers') {
      if (req.method === 'POST') {
        const ligne = JSON.parse((await lire(req)).toString('utf8'));
        if (dossiers.some((d) => d.numero === ligne.numero)) {
          return envoyerJson(res, 409, { code: '23505', message: 'duplicate key' });
        }
        const complete = Object.assign(
          { id: crypto.randomUUID(), cree_le: new Date().toISOString(), historique: [] },
          ligne
        );
        dossiers.push(complete);
        return envoyerJson(res, 201, [complete]);
      }
      if (req.method === 'PATCH') {
        const numero = eq(params, 'numero');
        const patch = JSON.parse((await lire(req)).toString('utf8'));
        const ligne = dossiers.find((d) => d.numero === numero);
        if (!ligne) return envoyerJson(res, 200, []);
        Object.assign(ligne, patch);
        return envoyerJson(res, 200, [ligne]);
      }
      if (req.method === 'DELETE') {
        const numero = eq(params, 'numero');
        const i = dossiers.findIndex((d) => d.numero === numero);
        if (i >= 0) dossiers.splice(i, 1);
        return envoyerJson(res, 204, {});
      }
      if (req.method === 'GET') {
        const numero = eq(params, 'numero');
        const statut = eq(params, 'statut');
        let resultat = dossiers.slice();
        if (numero) resultat = resultat.filter((d) => d.numero === numero);
        if (statut) resultat = resultat.filter((d) => d.statut === statut);
        if (params.get('order') === 'cree_le.desc') {
          resultat.sort((a, b) => String(b.cree_le).localeCompare(String(a.cree_le)));
        }
        const limite = Number(params.get('limit'));
        if (limite) resultat = resultat.slice(0, limite);
        if (params.get('select') === 'statut') {
          resultat = resultat.map((d) => ({ statut: d.statut }));
        }
        return envoyerJson(res, 200, resultat);
      }
    }

    /* ---- Table admin_tentatives ---- */
    if (chemin === '/rest/v1/admin_tentatives') {
      if (req.method === 'POST') {
        const ligne = JSON.parse((await lire(req)).toString('utf8'));
        tentatives.set(ligne.ip, ligne);   // Prefer: resolution=merge-duplicates
        return envoyerJson(res, 201, []);
      }
      if (req.method === 'GET') {
        const ip = eq(params, 'ip');
        const t = tentatives.get(ip);
        return envoyerJson(res, 200, t ? [t] : []);
      }
      if (req.method === 'DELETE') {
        tentatives.delete(eq(params, 'ip'));
        return envoyerJson(res, 204, {});
      }
    }

    /* ---- Storage : demande d'URL de dépôt signée ---- */
    if (req.method === 'POST' && chemin.startsWith('/storage/v1/object/upload/sign/preuves/')) {
      const cible = chemin.slice('/storage/v1/object/upload/sign/preuves/'.length);
      const jeton = crypto.randomBytes(16).toString('hex');
      jetonsDepot.set(jeton, cible);
      return envoyerJson(res, 200, {
        url: '/object/upload/sign/preuves/' + cible + '?token=' + jeton
      });
    }

    /* ---- Storage : dépôt effectif via l'URL signée ---- */
    if (req.method === 'PUT' && chemin.startsWith('/storage/v1/object/upload/sign/preuves/')) {
      const cible = chemin.slice('/storage/v1/object/upload/sign/preuves/'.length);
      const jeton = params.get('token');
      if (!jeton || jetonsDepot.get(jeton) !== cible) {
        return envoyerJson(res, 401, { message: 'jeton invalide' });
      }
      jetonsDepot.delete(jeton);           // usage unique
      fichiers.set(cible, {
        octets: await lire(req),
        type: req.headers['content-type'] || 'application/octet-stream'
      });
      return envoyerJson(res, 200, { Key: 'preuves/' + cible });
    }

    /* ---- Storage : lecture (bucket privé) ---- */
    if (req.method === 'GET' && chemin.startsWith('/storage/v1/object/authenticated/preuves/')) {
      const cible = chemin.slice('/storage/v1/object/authenticated/preuves/'.length);
      const f = fichiers.get(cible);
      if (!f) return envoyerJson(res, 404, { message: 'not found' });
      res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': f.octets.length });
      return res.end(f.octets);
    }

    /* ---- Storage : suppression ---- */
    if (req.method === 'DELETE' && chemin.startsWith('/storage/v1/object/preuves/')) {
      const cible = chemin.slice('/storage/v1/object/preuves/'.length);
      const existait = fichiers.delete(cible);
      return envoyerJson(res, existait ? 200 : 404, {});
    }

    envoyerJson(res, 404, { message: 'route inconnue du faux Supabase : ' + req.method + ' ' + chemin });
  });

  return { serveur, dossiers, fichiers };
}

/* ==========================================================================
   2. Adaptateur Vercel → Node
   ========================================================================== */

function adapter(req, res, corpsBrut, url) {
  req.query = Object.fromEntries(url.searchParams.entries());

  const type = String(req.headers['content-type'] || '');
  if (corpsBrut.length && type.includes('application/json')) {
    try { req.body = JSON.parse(corpsBrut.toString('utf8')); } catch { req.body = null; }
  } else {
    req.body = corpsBrut.length ? corpsBrut : undefined;
  }

  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (charge) => { res.end(charge); return res; };
}

/* ==========================================================================
   3. Serveur du site + API
   ========================================================================== */

const ROUTES = {
  '/api/catalogue': () => import('../api/catalogue.js'),
  '/api/preuve-url': () => import('../api/preuve-url.js'),
  '/api/dossiers': () => import('../api/dossiers.js'),
  '/api/suivi': () => import('../api/suivi.js'),
  '/api/admin/login': () => import('../api/admin/login.js'),
  '/api/admin/logout': () => import('../api/admin/logout.js'),
  '/api/admin/session': () => import('../api/admin/session.js'),
  '/api/admin/dossiers': () => import('../api/admin/dossiers.js'),
  '/api/admin/decision': () => import('../api/admin/decision.js'),
  '/api/admin/preuve': () => import('../api/admin/preuve.js')
};

export async function demarrer(options = {}) {
  const faux = demarrerFauxSupabase();
  await new Promise((r) => faux.serveur.listen(0, '127.0.0.1', r));
  const portSupabase = faux.serveur.address().port;

  process.env.SUPABASE_URL = 'http://127.0.0.1:' + portSupabase;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'cle-de-test';
  process.env.SESSION_SECRET = options.sessionSecret || crypto.randomBytes(32).toString('base64url');

  // L'empreinte est calculée ici : le code en clair n'existe que dans le test.
  const { empreinte } = await import('../api/_lib/auth.js');
  const codeAdmin = options.codeAdmin || 'code-de-test-123456';
  process.env.ADMIN_PASSWORD_HASH = empreinte(codeAdmin);

  const site = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://interne');
    const chemin = url.pathname;

    if (ROUTES[chemin]) {
      const morceaux = [];
      for await (const c of req) morceaux.push(c);
      adapter(req, res, Buffer.concat(morceaux), url);
      try {
        const module = await ROUTES[chemin]();
        await module.default(req, res);
      } catch (e) {
        console.error('[banc d\'essai]', e);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ erreur: String(e && e.message) }));
      }
      return;
    }

    // Fichiers statiques
    const relatif = chemin === '/' ? '/index.html' : chemin;
    const fichier = path.join(RACINE, decodeURIComponent(relatif));
    if (!fichier.startsWith(RACINE) || !fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('introuvable');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fichier)] || 'application/octet-stream' });
    res.end(fs.readFileSync(fichier));
  });

  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const portSite = site.address().port;

  return {
    origine: 'http://127.0.0.1:' + portSite,
    codeAdmin,
    dossiers: faux.dossiers,
    fichiers: faux.fichiers,
    async arreter() {
      await new Promise((r) => site.close(r));
      await new Promise((r) => faux.serveur.close(r));
    }
  };
}
