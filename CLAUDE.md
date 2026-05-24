# DadBank

Family savings and allowance tracking web app for young children.

## Tech stack

- **Next.js 16** (App Router, TypeScript)
- **Supabase** — PostgreSQL database + authentication
- **Vercel** — hosting + cron jobs
- **Resend** — email notifications
- **Tailwind CSS** — styling

## Users & auth

- Admin accounts: `lambert@jz`, `ivy@jz` (fake email format, email confirmation disabled in Supabase)
- Child accounts: e.g. `max@jz` — created via the admin panel at `/admin/children`
- Auth is standard Supabase `signInWithPassword`. No email verification flow.

## Project structure

```
app/
  login/         — login page (shared for all users)
  page.tsx       — redirects to /admin or /dashboard based on role
  admin/
    page.tsx         — dashboard: all children balances, recent transactions
    checklist/       — weekly chore checklist per child
    children/        — add/manage children, manual deposits/deductions
    settings/        — allowance, interest, tithe %, chore templates, categories
    withdrawals/     — approve/deny withdrawal requests
  dashboard/
    page.tsx         — child's balance, transactions, tithe box
    withdraw/        — child's ATM-style withdrawal request
  api/
    admin/create-child/  — create Supabase auth user + profile (uses service role key)
    withdrawal/          — submit withdrawal + email admins
    cron/
      allowance/   — Saturday 9am: pre-create checklists
      notify/      — Saturday 9pm: email admins to approve allowances
      interest/    — 1st of month: apply monthly interest
lib/
  supabase/client.ts  — browser Supabase client
  supabase/server.ts  — server + service role Supabase client
  resend.ts           — email templates (allowance reminder, withdrawal alert)
  types.ts            — shared TypeScript types
components/
  AdminNav.tsx   — top nav for admin pages
  ChildNav.tsx   — top nav for child pages
supabase/
  schema.sql     — full database schema (run this in Supabase SQL Editor)
```

## Environment variables (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=         # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Supabase anon (public) key
SUPABASE_SERVICE_ROLE_KEY=        # Supabase service role key (never expose to browser)
RESEND_API_KEY=                   # Resend API key
CRON_SECRET=                      # Random string — used to authenticate Vercel cron requests
NEXT_PUBLIC_APP_URL=              # Full URL of the deployed app (e.g. https://dadbank.vercel.app)
```

## One-time setup steps

### 1. Supabase

1. Create a new project at supabase.com (name it `dadbank`)
2. Go to **Authentication → Configuration → Email** → disable "Enable email confirmations"
3. Go to **SQL Editor** → paste and run the entire contents of `supabase/schema.sql`
4. Go to **Project Settings → API** → copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
5. Create admin accounts manually via **Authentication → Users → Add user**:
   - `lambert@jz` with your chosen password
   - `ivy@jz` with your chosen password
6. For each admin user just created, run in SQL Editor:
   ```sql
   insert into public.profiles (id, name, role, notification_email)
   values ('<user-uuid>', 'Lambert', 'admin', 'your.real@gmail.com');
   ```
   (Find the UUID in Authentication → Users)

### 2. Resend

1. Sign up at resend.com
2. Create an API key → paste into `RESEND_API_KEY`
3. By default emails send from `noreply@dadbank.app`. To use your own domain, add it in Resend → Domains and update the `from:` field in `lib/resend.ts`

### 3. Vercel

1. Push this repo to GitHub
2. Go to vercel.com → New Project → import from GitHub
3. Add all environment variables from `.env.local`
4. Deploy
5. Set `NEXT_PUBLIC_APP_URL` to your Vercel deployment URL
6. Cron jobs are defined in `vercel.json` and run automatically:
   - Saturday 9am UTC: pre-create checklists
   - Saturday 9pm UTC: email admins
   - 1st of month midnight UTC: apply interest
7. For cron auth, set `CRON_SECRET` to any random string in both Vercel env vars and your local `.env.local`

## Key business rules

- **Allowance**: All required chores checked → child gets default allowance. Each extra task checked → adds its reward on top.
- **Tithe**: Created automatically when admin approves allowance. Child must log in and set their tithe (min 10%, can give more). Tithe is deducted from balance.
- **Interest**: Applied on 1st of month to all positive balances. Rate is configurable in Settings.
- **Withdrawals**: Child submits request → admin gets email → admin approves/denies in `/admin/withdrawals`. If approved, amount is deducted from child's balance.
- **Manual adjustments**: Admin can deposit or deduct from any child's balance at `/admin/children`.
- **Balance trigger**: A database trigger (`trg_update_balance`) automatically updates `profiles.balance` whenever a transaction is inserted.

## Running locally

```bash
npm run dev
```

Open http://localhost:3000
