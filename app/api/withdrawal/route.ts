import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { sendWithdrawalAlert } from '@/lib/resend'

export async function POST(req: Request) {
  const serverSupabase = await createServerClient()
  const { data: { user } } = await serverSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { amount, category, reason } = await req.json()
  if (!amount || !category) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: child } = await serviceSupabase.from('profiles').select('name, balance').eq('id', user.id).single()
  if (!child) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  if (amount > child.balance) return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })

  // Insert withdrawal request
  const { error } = await serviceSupabase.from('withdrawal_requests').insert({
    child_id: user.id,
    amount,
    category,
    reason,
    status: 'pending',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Email admins
  const { data: admins } = await serviceSupabase
    .from('profiles')
    .select('notification_email')
    .eq('role', 'admin')
    .not('notification_email', 'is', null)

  const emails = (admins ?? []).map(a => a.notification_email).filter(Boolean) as string[]
  if (emails.length > 0) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://dadbank.vercel.app'
    await sendWithdrawalAlert(emails, child.name, amount, category, reason, appUrl)
  }

  return NextResponse.json({ ok: true })
}
