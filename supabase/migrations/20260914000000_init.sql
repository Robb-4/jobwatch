-- JobWatch — schéma initial, RLS et vues.
-- À appliquer via le SQL Editor du tableau de bord Supabase ou `supabase db push`.

-- ---------------------------------------------------------------------------
-- job_offers : toutes les offres importées, retenues ou écartées
-- ---------------------------------------------------------------------------
create table public.job_offers (
  id               bigint generated always as identity primary key,
  source           text        not null,
  external_id      text        not null,
  title            text        not null,
  company          text,
  location         text,
  contract_type    text,
  sector           text,
  naf_code         text,
  salary           text,
  url              text        not null,
  description      text,
  published_at     timestamptz,
  dedup_hash       text        not null,
  -- new = retenue, pas encore envoyée ; reported = envoyée ; rejected = écartée par un filtre
  status           text        not null default 'new' check (status in ('new', 'reported', 'rejected')),
  -- code stable (pour compter par motif) + élément déclencheur exact
  rejection_reason text,
  rejection_detail text,
  -- suivi personnel, indépendant du statut technique
  personal_status  text        check (personal_status in ('to_follow', 'applied', 'discarded')),
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  reported_at      timestamptz,
  constraint job_offers_source_external_id_key unique (source, external_id)
);

create index job_offers_dedup_hash_idx           on public.job_offers (dedup_hash);
create index job_offers_status_published_at_idx  on public.job_offers (status, published_at desc);
create index job_offers_created_at_idx           on public.job_offers (created_at);

-- ---------------------------------------------------------------------------
-- source_runs : une ligne par source et par exécution de `fetch`
-- ---------------------------------------------------------------------------
create table public.source_runs (
  id            bigint generated always as identity primary key,
  source        text        not null,
  label         text        not null,
  succeeded     boolean     not null,
  fetched       integer     not null default 0,
  created       integer     not null default 0,
  rejected      integer     not null default 0,
  duplicates    integer     not null default 0,
  error_message text,
  created_at    timestamptz not null default now(),
  -- renseigné quand la ligne a été comptabilisée dans un rapport
  reported_at   timestamptz
);

create index source_runs_created_at_idx on public.source_runs (created_at desc);
create index source_runs_unreported_idx on public.source_runs (created_at) where reported_at is null;

-- ---------------------------------------------------------------------------
-- settings : surcharges des critères (clé → JSON). Vide = configuration livrée.
-- ---------------------------------------------------------------------------
create table public.settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at automatique
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger job_offers_set_updated_at
  before update on public.job_offers
  for each row execute function public.set_updated_at();

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security : seul le rôle `authenticated` lit et écrit.
-- Aucune politique pour `anon` : sans session ouverte, les requêtes ne
-- renvoient rien. Les workflows Actions utilisent `service_role`, qui
-- contourne RLS.
-- ---------------------------------------------------------------------------
alter table public.job_offers  enable row level security;
alter table public.source_runs enable row level security;
alter table public.settings    enable row level security;

create policy "authenticated peut lire job_offers"
  on public.job_offers for select to authenticated using (true);

-- suivi personnel et notes depuis l'interface
create policy "authenticated peut modifier job_offers"
  on public.job_offers for update to authenticated using (true) with check (true);

create policy "authenticated peut lire source_runs"
  on public.source_runs for select to authenticated using (true);

create policy "authenticated gère settings"
  on public.settings for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Vues pour le tableau de bord. `security_invoker` : RLS s'applique à l'appelant.
-- ---------------------------------------------------------------------------
create view public.job_offer_status_counts
with (security_invoker = true) as
  select status, count(*)::integer as count
  from public.job_offers
  group by status;

create view public.rejection_reason_counts
with (security_invoker = true) as
  select rejection_reason, count(*)::integer as count
  from public.job_offers
  where status = 'rejected'
  group by rejection_reason;

create view public.latest_source_runs
with (security_invoker = true) as
  select distinct on (source) *
  from public.source_runs
  order by source, created_at desc;
