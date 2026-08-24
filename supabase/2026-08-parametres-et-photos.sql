-- ===========================================================================
-- Permis Express — mise à jour du 24/08/2026
--
-- À exécuter une fois dans le SQL Editor de Supabase, sur un projet où
-- schema.sql a déjà été passé. Ce script est idempotent : le relancer ne
-- casse rien.
--
-- Il ajoute :
--   1. la table des paramètres modifiables depuis l'espace administrateur
--      (coordonnées bancaires) ;
--   2. les colonnes NEPH et photo d'identité sur les dossiers ;
--   3. le bucket privé « photos ».
-- ===========================================================================


-- 1. Paramètres modifiables sans toucher au code -----------------------------

create table if not exists public.parametres (
  cle     text primary key,
  valeur  jsonb not null,
  maj_le  timestamptz not null default now()
);

alter table public.parametres enable row level security;
revoke all on public.parametres from anon, authenticated;


-- 2. Nouvelles informations demandées au client ------------------------------

alter table public.dossiers add column if not exists neph        text;
alter table public.dossiers add column if not exists photo_chemin text;
alter table public.dossiers add column if not exists photo_nom    text;
alter table public.dossiers add column if not exists photo_type   text;


-- 3. Bucket des photos d'identité
--
-- Privé, comme celui des preuves : une photo de personne est une donnée
-- personnelle et ne doit avoir aucune URL publique. Images uniquement, 5 Mo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos', 'photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- 4. Vérification ------------------------------------------------------------

select
  (select count(*) from public.parametres)                              as parametres,
  (select count(*) from storage.buckets where id = 'photos')            as bucket_photos,
  (select count(*) from information_schema.columns
     where table_name = 'dossiers' and column_name in
       ('neph', 'photo_chemin', 'photo_nom', 'photo_type'))             as colonnes_ajoutees;
