-- =====================================================================
-- Lebensdashboard – Supabase-Schema
-- Einmal komplett im Supabase SQL Editor ausführen (Run).
-- Kann gefahrlos erneut ausgeführt werden.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Profile (ein Eintrag pro Konto). Das ERSTE Konto wird automatisch Admin.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text check (char_length(display_name) <= 60),
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, is_admin)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)), 60),
    not exists (select 1 from public.profiles)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Nutzer dürfen nur ihren Namen ändern, niemals is_admin.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- Tägliche To-Dos (Vorlagen, die jeden Tag gelten)
-- created_on / archived_on halten die Historie korrekt fürs Diagramm.
-- ---------------------------------------------------------------------
create table if not exists public.daily_todos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  position     integer not null default 0,
  created_on   date not null,
  archived_on  date,
  created_at   timestamptz not null default now()
);
create index if not exists daily_todos_user_idx on public.daily_todos(user_id);

alter table public.daily_todos enable row level security;
drop policy if exists daily_todos_own on public.daily_todos;
create policy daily_todos_own on public.daily_todos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Abhaken pro Tag: Zeile vorhanden = erledigt.
create table if not exists public.daily_checks (
  todo_id     uuid not null references public.daily_todos(id) on delete cascade,
  day         date not null,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (todo_id, day)
);
create index if not exists daily_checks_user_day_idx on public.daily_checks(user_id, day);

alter table public.daily_checks enable row level security;
drop policy if exists daily_checks_select on public.daily_checks;
create policy daily_checks_select on public.daily_checks
  for select using (user_id = auth.uid());
drop policy if exists daily_checks_insert on public.daily_checks;
create policy daily_checks_insert on public.daily_checks
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.daily_todos t where t.id = todo_id and t.user_id = auth.uid())
  );
drop policy if exists daily_checks_delete on public.daily_checks;
create policy daily_checks_delete on public.daily_checks
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Aufgaben mit Datum. Unerledigte rutschen automatisch auf den nächsten Tag.
-- ---------------------------------------------------------------------
create table if not exists public.tasks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 300),
  due_date       date not null,
  original_date  date not null,
  moved_days     integer not null default 0,
  done           boolean not null default false,
  done_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists tasks_user_due_idx on public.tasks(user_id, due_date);

alter table public.tasks enable row level security;
drop policy if exists tasks_own on public.tasks;
create policy tasks_own on public.tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Verschiebt alle offenen Aufgaben aus der Vergangenheit auf p_today.
create or replace function public.roll_over_tasks(p_today date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  update public.tasks
     set moved_days = moved_days + (p_today - due_date),
         due_date   = p_today
   where user_id = auth.uid()
     and not done
     and due_date < p_today;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.roll_over_tasks(date) from public, anon;
grant execute on function public.roll_over_tasks(date) to authenticated;

-- Interne SECURITY-DEFINER-Funktionen nicht öffentlich per API aufrufbar machen
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- Zitate: alle dürfen lesen, nur Admins bearbeiten.
-- ---------------------------------------------------------------------
create table if not exists public.quotes (
  id          uuid primary key default gen_random_uuid(),
  text        text not null check (char_length(text) between 1 and 500),
  author      text check (char_length(author) <= 80),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.quotes enable row level security;
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes
  for select using (true);
drop policy if exists quotes_admin_insert on public.quotes;
create policy quotes_admin_insert on public.quotes
  for insert with check (public.is_admin());
drop policy if exists quotes_admin_update on public.quotes;
create policy quotes_admin_update on public.quotes
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists quotes_admin_delete on public.quotes;
create policy quotes_admin_delete on public.quotes
  for delete using (public.is_admin());

-- ---------------------------------------------------------------------
-- Fokus-Sessions
-- ---------------------------------------------------------------------
create table if not exists public.focus_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at       timestamptz not null,
  ended_at         timestamptz,
  planned_minutes  integer not null check (planned_minutes between 1 and 600),
  status           text not null default 'running'
                   check (status in ('running', 'completed', 'broken', 'aborted')),
  exits            integer not null default 0,
  call_exits       integer not null default 0
);
create index if not exists focus_sessions_user_idx on public.focus_sessions(user_id, started_at);

alter table public.focus_sessions enable row level security;
drop policy if exists focus_sessions_own on public.focus_sessions;
create policy focus_sessions_own on public.focus_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Startzitate (nur beim ersten Ausführen, wenn noch keine Zitate da sind)
-- ---------------------------------------------------------------------
insert into public.quotes (text, author)
select v.text, v.author
from (values
  ('Stay hard.', 'David Goggins'),
  ('Who''s gonna carry the boats?', 'David Goggins'),
  ('Denial is the ultimate comfort zone.', 'David Goggins'),
  ('We''re either getting better or we''re getting worse.', 'David Goggins'),
  ('The most important conversations you''ll ever have are the ones you''ll have with yourself.', 'David Goggins'),
  ('What color is your Bugatti?', 'Andrew Tate'),
  ('Escape the Matrix.', 'Andrew Tate'),
  ('Your mind must be stronger than your feelings.', 'Andrew Tate'),
  ('Every day is day one.', 'Arda Saatçi'),
  ('You vs you.', 'Arda Saatçi'),
  ('Du bist nicht dein Kopf und nicht dein Körper, du bist der Wille dazwischen.', 'Arda Saatçi'),
  ('Das, was ihr aber niemals von mir sehen werdet, ist, dass ich aufgebe.', 'Arda Saatçi'),
  ('Discipline equals freedom.', 'Jocko Willink'),
  ('Nobody cares, work harder.', 'Cameron Hanes'),
  ('Hard choices, easy life. Easy choices, hard life.', 'Jerzy Gregorek'),
  ('Niemand kommt, um dich zu retten.', null),
  ('Deine Ausreden interessieren niemanden.', null),
  ('Motivation ist ein Gefühl. Disziplin ist eine Entscheidung.', null),
  ('Du hast nicht zu wenig Zeit. Du hast zu wenig Disziplin.', null),
  ('Die Welt schuldet dir nichts.', null),
  ('Jede verschobene Aufgabe ist ein gebrochenes Versprechen an dich selbst.', null),
  ('Erledigt oder nicht erledigt. Dazwischen gibt es nichts.', null),
  ('Du verhandelst mit dir selbst. Und du verlierst.', null),
  ('Dein Potenzial zählt nichts, solange du es nicht nutzt.', null),
  ('Gestern ist vorbei. Was hast du heute vorzuweisen?', null),
  ('Respekt bekommt man nicht. Man verdient ihn.', null),
  ('Niemand erinnert sich an die, die fast durchgezogen haben.', null),
  ('Halbe Arbeit ist eine ganze Ausrede.', null),
  ('No one is coming. Get up.', null),
  ('Results don''t care how you feel.', null),
  ('You don''t need more time. You need fewer excuses.', null),
  ('Feelings are not a plan.', null),
  ('Do it tired. Do it bored. Do it anyway.', null),
  ('The alarm is not a suggestion.', null),
  ('Average is a choice. Stop choosing it.', null),
  ('Comfort is the enemy. Stop inviting it in.', null)
) as v(text, author)
where not exists (select 1 from public.quotes);
