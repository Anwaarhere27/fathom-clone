-- Fathom clone: initial schema.
-- Paste into the Supabase SQL editor and run. Safe to re-run.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- enums

do $$ begin
  create type meeting_source as enum ('bot', 'upload', 'live');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Mirrors what the UI shows in the meeting list while a call is in flight.
  create type meeting_status as enum (
    'scheduled', 'joining', 'recording', 'processing', 'ready', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type summary_template as enum (
    'general', 'sales_discovery', 'customer_interview', 'standup', 'all_hands'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- profiles

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  -- Demo workspaces are cloned per visitor and excluded from real-user views.
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, avatar_url, is_demo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, 'there@'), '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    new.is_anonymous
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------- google calendar link

create table if not exists google_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  google_email   text not null,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz not null,
  scope          text,
  created_at     timestamptz not null default now(),
  unique (user_id)
);

create table if not exists calendar_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  google_event_id  text,
  title            text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  meeting_url      text,
  platform         text,                      -- zoom | meet | teams
  attendees        jsonb not null default '[]'::jsonb,
  -- The per-meeting "record this" toggle.
  record_enabled   boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (user_id, google_event_id)
);

create index if not exists calendar_events_user_start_idx
  on calendar_events (user_id, starts_at);

-- ---------------------------------------------------------------- meetings

create table if not exists meetings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  title             text not null,
  started_at        timestamptz not null,
  duration_seconds  integer not null default 0,
  platform          text,
  source            meeting_source not null default 'bot',
  status            meeting_status not null default 'ready',
  media_url         text,
  media_type        text,                     -- audio/mpeg | video/mp4
  -- Denormalised so the list view needs one query, not a join per row.
  participant_count integer not null default 0,
  accent            text not null default 'indigo',
  created_at        timestamptz not null default now()
);

create index if not exists meetings_user_started_idx
  on meetings (user_id, started_at desc);

create table if not exists participants (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references meetings(id) on delete cascade,
  name          text not null,
  email         text,
  company       text,
  is_host       boolean not null default false,
  -- Drives the talk-time analytics panel.
  talk_seconds  integer not null default 0
);

create index if not exists participants_meeting_idx on participants (meeting_id);

-- --------------------------------------------------------------- transcript

create table if not exists transcript_segments (
  id             uuid primary key default gen_random_uuid(),
  meeting_id     uuid not null references meetings(id) on delete cascade,
  participant_id uuid references participants(id) on delete set null,
  speaker_name   text not null,
  idx            integer not null,
  start_ms       integer not null,
  end_ms         integer not null,
  text           text not null,
  -- Maintained by trigger below; powers cross-meeting search.
  fts            tsvector
);

create index if not exists transcript_meeting_idx
  on transcript_segments (meeting_id, idx);
create index if not exists transcript_meeting_start_idx
  on transcript_segments (meeting_id, start_ms);
create index if not exists transcript_fts_idx
  on transcript_segments using gin (fts);

create or replace function transcript_segments_fts()
returns trigger language plpgsql as $$
begin
  new.fts := to_tsvector('english', coalesce(new.text, ''));
  return new;
end $$;

drop trigger if exists transcript_segments_fts_trg on transcript_segments;
create trigger transcript_segments_fts_trg
  before insert or update of text on transcript_segments
  for each row execute function transcript_segments_fts();

-- ------------------------------------------------------ ai-generated output

-- One row per (meeting, template) so switching templates is a read, not a
-- regeneration. Missing rows are generated lazily and cached here.
create table if not exists summaries (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references meetings(id) on delete cascade,
  template      summary_template not null default 'general',
  -- [{ heading, bullets: [{ text, start_ms }] }]
  sections      jsonb not null default '[]'::jsonb,
  one_liner     text,
  model         text,
  generated_at  timestamptz not null default now(),
  unique (meeting_id, template)
);

create table if not exists action_items (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references meetings(id) on delete cascade,
  text        text not null,
  owner_name  text,
  due_hint    text,
  start_ms    integer,
  completed   boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists action_items_meeting_idx on action_items (meeting_id);

create table if not exists follow_up_emails (
  id            uuid primary key default gen_random_uuid(),
  meeting_id    uuid not null references meetings(id) on delete cascade,
  subject       text not null,
  body          text not null,
  generated_at  timestamptz not null default now()
);

-- ------------------------------------------------------ highlights + shares

create table if not exists highlights (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references meetings(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text,
  start_ms    integer not null,
  end_ms      integer not null,
  created_at  timestamptz not null default now()
);

create index if not exists highlights_meeting_idx on highlights (meeting_id, start_ms);

-- A share is a public, unauthenticated view of either a whole meeting or a
-- bounded clip of one. Read server-side with the service role, so RLS on the
-- underlying tables stays closed.
create table if not exists shares (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique default encode(gen_random_bytes(9), 'base64'),
  meeting_id   uuid not null references meetings(id) on delete cascade,
  highlight_id uuid references highlights(id) on delete set null,
  start_ms     integer,
  end_ms       integer,
  created_by   uuid references auth.users(id) on delete set null,
  view_count   integer not null default 0,
  created_at   timestamptz not null default now()
);

-- --------------------------------------------------------------- ask-ai log

create table if not exists ask_messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Null scope means the question ran across the whole meeting history.
  meeting_id  uuid references meetings(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  citations   jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ask_messages_user_idx on ask_messages (user_id, created_at);

-- --------------------------------------------------------------------- rls

alter table profiles            enable row level security;
alter table google_connections  enable row level security;
alter table calendar_events     enable row level security;
alter table meetings            enable row level security;
alter table participants        enable row level security;
alter table transcript_segments enable row level security;
alter table summaries           enable row level security;
alter table action_items        enable row level security;
alter table follow_up_emails    enable row level security;
alter table highlights          enable row level security;
alter table shares              enable row level security;
alter table ask_messages        enable row level security;

-- Own-row access for the tables that carry user_id directly.
do $$
declare t text;
begin
  foreach t in array array[
    'google_connections', 'calendar_events', 'meetings', 'highlights', 'ask_messages'
  ] loop
    execute format('drop policy if exists %1$s_own on %1$I', t);
    execute format(
      'create policy %1$s_own on %1$I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

drop policy if exists profiles_own on profiles;
create policy profiles_own on profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Child tables inherit access from the meeting they hang off.
do $$
declare t text;
begin
  foreach t in array array[
    'participants', 'transcript_segments', 'summaries', 'action_items',
    'follow_up_emails', 'shares'
  ] loop
    execute format('drop policy if exists %1$s_via_meeting on %1$I', t);
    execute format(
      'create policy %1$s_via_meeting on %1$I for all to authenticated
         using (exists (select 1 from meetings m
                        where m.id = %1$I.meeting_id and m.user_id = auth.uid()))
         with check (exists (select 1 from meetings m
                        where m.id = %1$I.meeting_id and m.user_id = auth.uid()))', t);
  end loop;
end $$;

-- ------------------------------------------------------------ demo template

-- The seeded workspace lives under one template user. Every "Try the demo"
-- visitor signs in anonymously and gets their own copy, so no two visitors
-- can scribble over each other's data.
create table if not exists demo_template (
  id       boolean primary key default true check (id),
  user_id  uuid not null references auth.users(id) on delete cascade
);

create or replace function clone_demo_workspace(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  source_user uuid;
  meeting_map jsonb := '{}'::jsonb;
  participant_map jsonb := '{}'::jsonb;
  m record;
  new_meeting_id uuid;
begin
  select user_id into source_user from demo_template where id;
  if source_user is null then
    raise exception 'demo template not seeded';
  end if;
  if exists (select 1 from meetings where user_id = target_user) then
    return;  -- already cloned
  end if;

  for m in select * from meetings where user_id = source_user loop
    insert into meetings (user_id, title, started_at, duration_seconds, platform,
                          source, status, media_url, media_type,
                          participant_count, accent)
    values (target_user, m.title, m.started_at, m.duration_seconds, m.platform,
            m.source, m.status, m.media_url, m.media_type,
            m.participant_count, m.accent)
    returning id into new_meeting_id;

    meeting_map := meeting_map || jsonb_build_object(m.id::text, new_meeting_id);

    -- Participants first: transcript segments point at them.
    with inserted as (
      insert into participants (meeting_id, name, email, company, is_host, talk_seconds)
      select new_meeting_id, p.name, p.email, p.company, p.is_host, p.talk_seconds
      from participants p where p.meeting_id = m.id
      returning id, name
    )
    select coalesce(participant_map || jsonb_object_agg(src.id::text, inserted.id), participant_map)
    into participant_map
    from inserted
    join participants src on src.meeting_id = m.id and src.name = inserted.name;

    insert into transcript_segments (meeting_id, participant_id, speaker_name, idx,
                                     start_ms, end_ms, text)
    select new_meeting_id,
           (participant_map->>t.participant_id::text)::uuid,
           t.speaker_name, t.idx, t.start_ms, t.end_ms, t.text
    from transcript_segments t where t.meeting_id = m.id;

    insert into summaries (meeting_id, template, sections, one_liner, model)
    select new_meeting_id, s.template, s.sections, s.one_liner, s.model
    from summaries s where s.meeting_id = m.id;

    insert into action_items (meeting_id, text, owner_name, due_hint, start_ms, completed)
    select new_meeting_id, a.text, a.owner_name, a.due_hint, a.start_ms, a.completed
    from action_items a where a.meeting_id = m.id;

    insert into follow_up_emails (meeting_id, subject, body)
    select new_meeting_id, f.subject, f.body
    from follow_up_emails f where f.meeting_id = m.id;

    insert into highlights (meeting_id, user_id, label, start_ms, end_ms)
    select new_meeting_id, target_user, h.label, h.start_ms, h.end_ms
    from highlights h where h.meeting_id = m.id;
  end loop;

  insert into calendar_events (user_id, google_event_id, title, starts_at, ends_at,
                               meeting_url, platform, attendees, record_enabled)
  select target_user, null, c.title,
         -- Re-anchor to the visitor's "now" so upcoming meetings stay upcoming.
         now() + (c.starts_at - date_trunc('day', c.starts_at)),
         now() + (c.ends_at - date_trunc('day', c.starts_at)),
         c.meeting_url, c.platform, c.attendees, c.record_enabled
  from calendar_events c where c.user_id = source_user;

  update profiles set is_demo = true where id = target_user;
end $$;

grant execute on function clone_demo_workspace(uuid) to authenticated;
