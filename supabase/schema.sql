-- ===========================================================================
-- Permis Express — schéma Supabase
--
-- À exécuter une seule fois dans le SQL Editor de votre projet Supabase
-- (Dashboard → SQL Editor → New query → coller → Run).
--
-- Ce script est idempotent : le relancer ne casse rien.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Table des dossiers
-- ---------------------------------------------------------------------------

create table if not exists public.dossiers (
  id              uuid primary key default gen_random_uuid(),
  numero          text unique not null,          -- PE-2026-123456
  cree_le         timestamptz not null default now(),

  -- Client
  prenom          text not null,
  nom             text not null,
  naissance       date,
  email           text not null,
  telephone       text,
  ville           text,
  adresse         text,
  pays            text,
  situation       text,

  -- Formation retenue
  permis_id       text not null,
  permis_nom      text not null,
  montant         integer not null,              -- en euros, entier

  -- Paiement
  moyen_id        text,
  moyen_nom       text,
  reference_wu    text,                          -- MTCN Western Union
  preuve_chemin   text,                          -- chemin dans le bucket « preuves »
  preuve_nom      text,                          -- nom du fichier d'origine
  preuve_type     text,                          -- type MIME

  -- Décision de l'administrateur
  statut          text not null default 'pending'
                  check (statut in ('pending', 'approved', 'rejected')),
  message         text,                          -- message transmis au client
  decide_le       timestamptz,
  renvoye_le      timestamptz,                   -- date du dernier renvoi de preuve
  historique      jsonb not null default '[]'::jsonb
);

create index if not exists dossiers_statut_idx  on public.dossiers (statut);
create index if not exists dossiers_cree_le_idx on public.dossiers (cree_le desc);
-- La consultation client se fait par numéro + e-mail : on indexe le couple.
create index if not exists dossiers_suivi_idx   on public.dossiers (numero, lower(email));


-- ---------------------------------------------------------------------------
-- 2. Limitation des tentatives de connexion administrateur
-- ---------------------------------------------------------------------------

create table if not exists public.admin_tentatives (
  ip              text primary key,
  echecs          integer not null default 0,
  bloque_jusqu_a  timestamptz,
  maj_le          timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 3. Verrouillage des accès
--
-- RLS activé SANS aucune policy : ni la clé `anon` ni la clé publique ne
-- peuvent lire ou écrire quoi que ce soit. Seules les fonctions serverless,
-- qui utilisent la clé `service_role`, y accèdent — et cette clé ne quitte
-- jamais le serveur.
-- ---------------------------------------------------------------------------

alter table public.dossiers        enable row level security;
alter table public.admin_tentatives enable row level security;

revoke all on public.dossiers         from anon, authenticated;
revoke all on public.admin_tentatives from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Bucket de stockage des preuves de paiement
--
-- Privé : aucun fichier n'est accessible par URL publique. Les téléversements
-- passent par une URL signée à usage unique, générée par l'API ; la lecture
-- passe par /api/admin/preuve, qui exige une session administrateur.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'preuves', 'preuves', false, 10485760,        -- 10 Mo
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------------------
-- 5. Vérification
-- ---------------------------------------------------------------------------

select
  (select count(*) from public.dossiers)                          as dossiers,
  (select count(*) from storage.buckets where id = 'preuves')     as bucket_preuves,
  (select relrowsecurity from pg_class where relname = 'dossiers') as rls_active;
