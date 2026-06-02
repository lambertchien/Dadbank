# DadBank — Development Summary

## What is DadBank

A family savings and allowance tracking web app for young children. Parents manage weekly chore checklists, approve allowances, and track each child's balance. Children log their own bonus task sessions, decide their tithe, request withdrawals, and watch their savings grow.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth) · Vercel (hosting + crons) · Resend (email) · Tailwind CSS

---

## v1.1 — 2026-06-03 (security & correctness hardening)

Post-audit fixes from a full code review of v1.0.

### Critical fixes
- **Tithe submit is now atomic-safe** — income transaction, tithe deduction, and record update previously had no error handling; a crash mid-way left the child's balance credited with no tithe deducted. Now: `tithePct` is validated upfront, an idempotency check prevents double-crediting on retry, and if the tithe insert fails the income is rolled back before returning an error.
- **Minimum tithe uses the rate locked on the record** — the dashboard was validating against the current app setting, so if the admin raised the tithe rate after a record was created, children were blocked from submitting a previously valid amount. Now uses `record.tithe_percentage`.

### Data-safety fixes
- **deleteChore preserves approved history** — previously deleted all `checklist_items` across all weeks including approved ones. Now only removes items from pending (non-approved) checklists; if approved items exist the FK constraint surfaces a clear message.
- **Landing page tithe query error handled** — an RLS or network failure on the `tithe_records` check silently returned null, routing the child to My Works instead of My Bank and leaving their tithe stuck forever. Now falls back to `/dashboard` on error.

### Correctness fixes
- **`isInterest` heuristic tightened** — changed from `.includes('interest')` (could match any admin deposit description) to `.startsWith('Monthly interest (')` which matches only the exact cron format.
- **`admin_adjusted` column added to schema.sql** — the column was applied via a manual migration but missing from the canonical schema file; fresh deployments would silently break admin count overrides.
- **`missingInserts` error now logged** — a concurrent admin tab race could cause a silent duplicate-key failure; error is now logged and re-fetch always runs regardless.
- **`NEXT_PUBLIC_APP_URL` absence now logged** — if the env var is unset, weekly summary email links would be broken silently; now logs an error to Vercel function logs.

---

## v1.0 — 2026-06-03 (feature complete)

### Core financial flows

**Allowance with tithe gate**
Children do not receive money directly when allowance is approved. Instead, a pending tithe record is created. The child must log in, decide their tithe percentage (minimum 10%, can give more), and only then the net amount (income minus tithe) lands in their balance. Required chores (Part I) all checked = base allowance. Extra tasks (Part II) = bonus on top.

**Interest with tithe gate**
Monthly interest (1st of each month) was previously deposited directly. Changed so interest also goes through the tithe gate — a pending tithe card appears on the child's dashboard, same as allowance. Each income source (allowance, interest, manual deposit) gets its own separate tithe card so children can see and decide on each independently.

**Multiple pending tithe cards**
The dashboard now shows all pending tithe records as separate cards, sorted oldest first. Each has its own tithe slider and independent submit. If a child misses allowance day and interest also accrues, both cards show simultaneously.

**Smart landing page**
After login, children with pending tithe decisions land on My Bank so they see the cards immediately. Children with no pending income land on My Works (the task log page).

### My Works — child self-reported task logging

New tab in the child's navigation (default landing when no pending income):
- **Part I** — read-only reminder of required chores for the week
- **Part II** — extra reward tasks assigned to this child; tap `+1` each time a session is completed; the app records the exact date and time
- Sessions can be deleted by the child (if they tapped by mistake)
- Count badges show total sessions this week; expand to see the full timestamp log

On the admin side, Part II counts on the checklist are auto-populated from the child's session logs when the admin opens the page. The admin can still adjust up or down with `+`/`−` buttons. A `📱 N` badge expands to show the child's individual session timestamps. A **Refresh counts** button re-syncs without a full page reload.

Admin count overrides persist across reloads (`admin_adjusted` flag prevents the sync from overwriting manual adjustments).

### Per-child task assignment

Extra tasks are assigned per child in Settings. The child's My Works page and the admin checklist both show only the tasks assigned to that specific child. When assignments change, the checklist is updated automatically on next load (missing items are inserted; display is filtered immediately).

Guards in Settings prevent inconsistent state:
- Cannot remove an assignment if the checklist still counts sessions for that task (must zero the count first)
- Cannot disable a chore if any child has active session counts this week
- Cannot delete a chore if it is assigned to any child or has active session counts

### Account management moved to Settings

Add Child and Delete Account buttons were removed from the Children page (too easy to hit accidentally). Both now live in a dedicated **Account Management** section in Settings, alongside the existing chore assignments and financial settings.

### Weekly summary email

Every Sunday at 9pm SGT, all admin notification emails receive a summary containing each child's current balance and up to 20 most recent transactions from the last 6 months.

### Other improvements
- Login redirects through the root page so smart landing logic always applies
- Delete child fully clears all FK-dependent tables before removing the auth user
- Chore deletion is gated: assigned tasks, tasks with active session counts, and tasks with approved history each show a specific orange warning banner
- Warning banners use fixed positioning so they are visible regardless of scroll position
- All admin cron jobs authenticate via `CRON_SECRET` header or query param

---

## Cron schedule (all times SGT, UTC+8)

| Job | Schedule | What it does |
|-----|----------|--------------|
| `allowance` | Saturday 9am | Pre-creates weekly checklists for each child |
| `notify` | Saturday 9pm | Emails admins to review checklists |
| `interest` | 1st of month midnight | Creates pending tithe records for monthly interest |
| `weekly-summary` | Sunday 9pm | Emails admins a balance + transaction summary |

---

## Database tables added during development

| Table | Purpose |
|-------|---------|
| `extra_task_logs` | Child self-reported session timestamps for extra tasks |
| `chore_assignments` | Per-child task assignment (which extra tasks each child has) |

### Column additions
| Table | Column | Purpose |
|-------|--------|---------|
| `checklist_items` | `admin_adjusted` | Marks items where admin has manually overridden the count; sync skips these |
