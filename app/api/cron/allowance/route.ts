import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Runs every Saturday at 9am — pre-creates checklist rows for each child
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const today = new Date()
  const weekStart = today.toISOString().split('T')[0]

  const [{ data: children }, { data: chores }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('id').eq('role', 'child'),
    supabase.from('chore_templates').select('*').eq('active', true),
    supabase.from('app_settings').select('value').eq('key', 'default_allowance').single(),
  ])

  const defaultAllowance = parseFloat(settings?.value ?? '100')
  const created: string[] = []

  for (const child of children ?? []) {
    // Skip if already exists
    const { data: existing } = await supabase
      .from('weekly_checklists')
      .select('id')
      .eq('child_id', child.id)
      .eq('week_start', weekStart)
      .single()

    if (existing) continue

    const { data: newCl } = await supabase
      .from('weekly_checklists')
      .insert({ child_id: child.id, week_start: weekStart, base_amount: 0, extra_amount: 0 })
      .select('id')
      .single()

    if (newCl && chores && chores.length > 0) {
      await supabase.from('checklist_items').insert(
        chores.map(c => ({
          checklist_id: newCl.id,
          chore_id: c.id,
          checked: false,
          reward_earned: 0,
        }))
      )
    }

    created.push(child.id)
  }

  return NextResponse.json({ ok: true, created: created.length, default_allowance: defaultAllowance })
}
