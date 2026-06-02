import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWeeklySummary } from '@/lib/resend'

// Runs every Sunday at 9pm SGT (1pm UTC)
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

  const { data: admins } = await supabase
    .from('profiles')
    .select('notification_email')
    .eq('role', 'admin')
    .not('notification_email', 'is', null)

  const to = (admins ?? []).map(a => a.notification_email).filter(Boolean) as string[]
  if (to.length === 0) return NextResponse.json({ ok: true, skipped: 'no admin emails configured' })

  const { data: childProfiles } = await supabase
    .from('profiles')
    .select('id, name, balance')
    .eq('role', 'child')
    .order('name')

  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const children = await Promise.all((childProfiles ?? []).map(async child => {
    const { data: transactions } = await supabase
      .from('transactions')
      .select('type, amount, description, created_at')
      .eq('child_id', child.id)
      .gte('created_at', sixMonthsAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(20)

    return { name: child.name, balance: child.balance, transactions: transactions ?? [] }
  }))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  if (!appUrl) console.error('[weekly-summary] NEXT_PUBLIC_APP_URL is not set — email links will be broken')
  await sendWeeklySummary(to, children, appUrl)

  return NextResponse.json({ ok: true, children: children.length, to: to.length })
}
