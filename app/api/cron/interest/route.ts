import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Runs on the 1st of every month at midnight
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const qs = new URL(req.url).searchParams.get('secret')
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && qs !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const [{ data: rateSettings }, { data: titheSettings }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', 'interest_rate').single(),
    supabase.from('app_settings').select('value').eq('key', 'tithe_percentage').single(),
  ])

  const rate = parseFloat(rateSettings?.value ?? '1') / 100
  const tithePct = parseFloat(titheSettings?.value ?? '10')

  const { data: children } = await supabase
    .from('profiles')
    .select('id, name, balance')
    .eq('role', 'child')

  const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const processed: { name: string; interest: number }[] = []

  for (const child of children ?? []) {
    if (child.balance <= 0) continue
    const interest = Math.ceil(child.balance * rate)
    if (interest <= 0) continue

    // Create a pending tithe record — interest is NOT deposited until child decides their tithe
    await supabase.from('tithe_records').insert({
      child_id: child.id,
      checklist_id: null,
      income_amount: interest,
      tithe_amount: Math.ceil(interest * tithePct / 100),
      tithe_percentage: tithePct,
      completed: false,
      description: `Monthly interest (${(rate * 100).toFixed(1)}%) — ${month}`,
    })

    processed.push({ name: child.name, interest })
  }

  return NextResponse.json({ ok: true, rate: rate * 100, processed })
}
