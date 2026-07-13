-- AI League schema: profiles, teams, matches + RLS.
-- Public read on everything; owners write only their own team's editable
-- columns; matches and elo/W/D/L are written only by the play-match Edge
-- Function (service role) through apply_match_result below.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 20),
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null unique references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  config jsonb not null,
  version int not null default 1,
  elo int not null default 1000,
  wins int not null default 0,
  draws int not null default 0,
  losses int not null default 0,
  created_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  team_a uuid not null references public.teams (id) on delete cascade,
  team_b uuid not null references public.teams (id) on delete cascade,
  version_a int not null,
  version_b int not null,
  seed bigint not null,
  score_a int not null,
  score_b int not null,
  elo_delta_a int not null,
  elo_delta_b int not null,
  engine_version int not null,
  -- Config snapshots at play time so replays survive later team edits.
  config_a jsonb not null,
  config_b jsonb not null,
  created_at timestamptz not null default now()
);

create index matches_team_a_created_idx on public.matches (team_a, created_at desc);
create index matches_team_b_created_idx on public.matches (team_b, created_at desc);
create index teams_elo_idx on public.teams (elo desc);

-- ---------- RLS ----------

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.matches enable row level security;

-- Public read on all three.
create policy "profiles are public" on public.profiles
  for select using (true);
create policy "teams are public" on public.teams
  for select using (true);
create policy "matches are public" on public.matches
  for select using (true);

-- Users manage their own profile row.
create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = id);
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Owners insert/update their own team...
create policy "insert own team" on public.teams
  for insert with check (auth.uid() = owner);
create policy "update own team" on public.teams
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

-- ...but only the editable columns: elo/W/D/L are service-role-only, enforced
-- with column-level grants (RLS is row-level; grants gate the columns).
revoke insert, update, delete on public.teams from anon, authenticated;
grant insert (id, owner, name, config, version) on public.teams to authenticated;
grant update (name, config, version) on public.teams to authenticated;

-- No client writes matches; there are no insert/update policies and no grants.
revoke insert, update, delete on public.matches from anon, authenticated;
revoke insert, update, delete on public.profiles from anon;

-- ---------- Match application ----------

-- Inserts the match row and applies both teams' elo/W/D/L updates in one
-- transaction, so a failure writes nothing (no partial Elo updates).
create or replace function public.apply_match_result(
  p_team_a uuid,
  p_team_b uuid,
  p_version_a int,
  p_version_b int,
  p_seed bigint,
  p_score_a int,
  p_score_b int,
  p_delta_a int,
  p_delta_b int,
  p_engine_version int,
  p_config_a jsonb,
  p_config_b jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m_id uuid;
begin
  insert into matches (
    team_a, team_b, version_a, version_b, seed, score_a, score_b,
    elo_delta_a, elo_delta_b, engine_version, config_a, config_b
  ) values (
    p_team_a, p_team_b, p_version_a, p_version_b, p_seed, p_score_a, p_score_b,
    p_delta_a, p_delta_b, p_engine_version, p_config_a, p_config_b
  ) returning id into m_id;

  update teams set
    elo = elo + p_delta_a,
    wins = wins + (p_score_a > p_score_b)::int,
    draws = draws + (p_score_a = p_score_b)::int,
    losses = losses + (p_score_a < p_score_b)::int
  where id = p_team_a;

  update teams set
    elo = elo + p_delta_b,
    wins = wins + (p_score_b > p_score_a)::int,
    draws = draws + (p_score_b = p_score_a)::int,
    losses = losses + (p_score_b < p_score_a)::int
  where id = p_team_b;

  return m_id;
end;
$$;

-- Only the Edge Function (service role) may apply results.
revoke execute on function public.apply_match_result from public, anon, authenticated;
grant execute on function public.apply_match_result to service_role;
