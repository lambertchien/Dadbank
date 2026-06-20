-- ─────────────────────────────────────────────────────────────
-- DadBank Schema
-- Run this entire file in Supabase → SQL Editor
-- ─────────────────────────────────────────────────────────────

-- ── Profiles (extends auth.users) ────────────────────────────
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  name              text not null,
  role              text not null check (role in ('admin', 'child')),
  notification_email text,           -- real email for admin alerts
  balance           numeric(10,2) not null default 0,
  starting_balance  numeric(10,2) not null default 0,
  created_at        timestamptz default now()
);
alter table public.profiles enable row level security;

create policy "users can read own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "admins can read all profiles" on public.profiles
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "admins can update all profiles" on public.profiles
  for update using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "admins can insert profiles" on public.profiles
  for insert with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ── App Settings ──────────────────────────────────────────────
create table if not exists public.app_settings (
  key         text primary key,
  value       text not null,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz default now()
);
alter table public.app_settings enable row level security;

create policy "everyone can read settings" on public.app_settings
  for select using (true);

create policy "admins can update settings" on public.app_settings
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Default settings
insert into public.app_settings (key, value) values
  ('default_allowance', '100'),
  ('interest_rate', '1'),
  ('tithe_percentage', '10')
on conflict (key) do nothing;

-- ── Spending Categories ───────────────────────────────────────
create table if not exists public.spending_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  sort_order int not null default 0
);
alter table public.spending_categories enable row level security;

create policy "everyone can read categories" on public.spending_categories
  for select using (true);

create policy "admins can manage categories" on public.spending_categories
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Default categories
insert into public.spending_categories (name, sort_order) values
  ('Clothes / Shoes', 1),
  ('Gaming', 2),
  ('Giving', 3),
  ('Others', 4)
on conflict (name) do nothing;

-- ── Chore Templates ───────────────────────────────────────────
create table if not exists public.chore_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          text not null check (type in ('required', 'extra')),
  reward_amount numeric(10,2),   -- only for 'extra' type
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz default now()
);
alter table public.chore_templates enable row level security;

create policy "everyone can read chore templates" on public.chore_templates
  for select using (true);

create policy "admins can manage chore templates" on public.chore_templates
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Default chores
insert into public.chore_templates (name, type, reward_amount, sort_order) values
  ('Make bed every day', 'required', null, 1),
  ('Keep room tidy', 'required', null, 2),
  ('Do assigned dishes', 'required', null, 3),
  ('Complete homework on time', 'required', null, 4),
  ('Good attitude all week', 'required', null, 5),
  ('Extra cleaning (bathroom/floors)', 'extra', 20, 1),
  ('Help with laundry', 'extra', 15, 2),
  ('Read for 30 min every day', 'extra', 25, 3),
  ('No screen time complaints', 'extra', 10, 4)
on conflict do nothing;

-- ── Weekly Checklists ─────────────────────────────────────────
create table if not exists public.weekly_checklists (
  id           uuid primary key default gen_random_uuid(),
  child_id     uuid not null references public.profiles(id) on delete cascade,
  week_start   date not null,   -- Saturday of the allowance week
  status       text not null default 'pending' check (status in ('pending', 'approved')),
  base_amount  numeric(10,2) not null default 0,
  extra_amount numeric(10,2) not null default 0,
  approved_by  uuid references auth.users(id),
  approved_at  timestamptz,
  created_at   timestamptz default now(),
  unique(child_id, week_start)
);
alter table public.weekly_checklists enable row level security;

create policy "children can read own checklists" on public.weekly_checklists
  for select using (auth.uid() = child_id);

create policy "admins can manage all checklists" on public.weekly_checklists
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ── Checklist Items ───────────────────────────────────────────
create table if not exists public.checklist_items (
  id            uuid primary key default gen_random_uuid(),
  checklist_id  uuid not null references public.weekly_checklists(id) on delete cascade,
  chore_id      uuid not null references public.chore_templates(id),
  checked       boolean not null default false,
  reward_earned numeric(10,2) not null default 0
);
alter table public.checklist_items enable row level security;

create policy "children can read own checklist items" on public.checklist_items
  for select using (
    exists (
      select 1 from public.weekly_checklists wc
      where wc.id = checklist_id and wc.child_id = auth.uid()
    )
  );

create policy "admins can manage all checklist items" on public.checklist_items
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ── Transactions ──────────────────────────────────────────────
create table if not exists public.transactions (
  id           uuid primary key default gen_random_uuid(),
  child_id     uuid not null references public.profiles(id) on delete cascade,
  amount       numeric(10,2) not null,  -- positive = credit, negative = debit
  type         text not null check (type in ('allowance','interest','tithe','withdrawal','deposit','adjustment')),
  category     text,
  description  text not null,
  reference_id uuid,
  created_by   uuid references auth.users(id),
  created_at   timestamptz default now()
);
alter table public.transactions enable row level security;

create policy "children can read own transactions" on public.transactions
  for select using (auth.uid() = child_id);

create policy "admins can manage all transactions" on public.transactions
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ── Withdrawal Requests ───────────────────────────────────────
create table if not exists public.withdrawal_requests (
  id             uuid primary key default gen_random_uuid(),
  child_id       uuid not null references public.profiles(id) on delete cascade,
  amount         numeric(10,2) not null,
  category       text not null,
  reason         text not null,
  status         text not null default 'pending' check (status in ('pending','approved','denied')),
  decided_by     uuid references auth.users(id),
  decided_at     timestamptz,
  transaction_id uuid references public.transactions(id),
  created_at     timestamptz default now()
);
alter table public.withdrawal_requests enable row level security;

create policy "children can read own withdrawals" on public.withdrawal_requests
  for select using (auth.uid() = child_id);

create policy "children can insert own withdrawals" on public.withdrawal_requests
  for insert with check (auth.uid() = child_id);

create policy "admins can manage all withdrawals" on public.withdrawal_requests
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ── Tithe Records ─────────────────────────────────────────────
create table if not exists public.tithe_records (
  id               uuid primary key default gen_random_uuid(),
  child_id         uuid not null references public.profiles(id) on delete cascade,
  checklist_id     uuid references public.weekly_checklists(id),
  income_amount    numeric(10,2) not null,
  tithe_amount     numeric(10,2) not null,
  tithe_percentage numeric(5,2) not null,
  completed        boolean not null default false,
  description      text,
  created_at       timestamptz default now()
);
alter table public.tithe_records enable row level security;

create policy "children can read own tithe records" on public.tithe_records
  for select using (auth.uid() = child_id);

create policy "children can update own tithe records" on public.tithe_records
  for update using (auth.uid() = child_id);

create policy "admins can manage all tithe records" on public.tithe_records
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ── Helper: update balance on transaction insert ──────────────
create or replace function public.update_balance_on_transaction()
returns trigger language plpgsql security definer as $$
begin
  update public.profiles
  set balance = balance + NEW.amount
  where id = NEW.child_id;
  return NEW;
end;
$$;

create trigger trg_update_balance
  after insert on public.transactions
  for each row execute function public.update_balance_on_transaction();

-- ── Admin count override flag (run this if not already applied) ──
alter table public.checklist_items add column if not exists admin_adjusted boolean not null default false;

-- ── Extra task logs (child self-reported sessions) ────────────
create table if not exists public.extra_task_logs (
  id         uuid primary key default gen_random_uuid(),
  child_id   uuid not null references public.profiles(id) on delete cascade,
  chore_id   uuid not null references public.chore_templates(id) on delete cascade,
  week_start date not null,
  logged_at  timestamptz default now()
);
alter table public.extra_task_logs enable row level security;

create policy "children can manage own logs" on public.extra_task_logs
  for all using (auth.uid() = child_id);

create policy "admins can read all logs" on public.extra_task_logs
  for select using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy "admins can delete all logs" on public.extra_task_logs
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
