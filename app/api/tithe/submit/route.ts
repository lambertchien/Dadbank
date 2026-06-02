import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request) {
  const serverSupabase = await createServerClient()
  const { data: { user } } = await serverSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { titheRecordId, titheAmount, tithePct } = await req.json()
  if (!titheRecordId || titheAmount == null || tithePct == null) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  if (!Number.isFinite(titheAmount) || !Number.isFinite(tithePct)) {
    return NextResponse.json({ error: 'Invalid tithe values' }, { status: 400 })
  }

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Verify this tithe record belongs to the logged-in child
  const { data: record } = await serviceSupabase
    .from('tithe_records')
    .select('*')
    .eq('id', titheRecordId)
    .eq('child_id', user.id)
    .eq('completed', false)
    .single()

  if (!record) return NextResponse.json({ error: 'Tithe record not found' }, { status: 404 })

  const minTithe = record.income_amount * record.tithe_percentage / 100
  if (titheAmount < minTithe - 0.01) {
    return NextResponse.json({ error: `Tithe must be at least ${record.tithe_percentage}%` }, { status: 400 })
  }
  if (titheAmount > record.income_amount) {
    return NextResponse.json({ error: 'Tithe cannot exceed your allowance' }, { status: 400 })
  }

  const isInterest = !record.checklist_id && record.description?.startsWith('Monthly interest (')
  const txType = record.checklist_id ? 'allowance' : (isInterest ? 'interest' : 'deposit')
  const txDesc = record.checklist_id ? 'Weekly allowance' : (record.description || 'Admin deposit')

  // Idempotency: skip inserts if income transaction was already recorded (e.g. prior partial failure)
  const { data: existingIncome } = await serviceSupabase
    .from('transactions')
    .select('id')
    .eq('child_id', user.id)
    .eq('reference_id', record.checklist_id ?? record.id)
    .eq('type', txType)
    .maybeSingle()

  if (!existingIncome) {
    // Insert income transaction
    const { error: incomeErr } = await serviceSupabase.from('transactions').insert({
      child_id: user.id,
      amount: record.income_amount,
      type: txType,
      description: txDesc,
      reference_id: record.checklist_id ?? record.id,
      created_by: user.id,
    })
    if (incomeErr) {
      return NextResponse.json({ error: 'Failed to record income. Please try again.' }, { status: 500 })
    }

    // Insert tithe deduction
    const { error: titheErr } = await serviceSupabase.from('transactions').insert({
      child_id: user.id,
      amount: -titheAmount,
      type: 'tithe',
      description: `Tithe (${(+tithePct).toFixed(1)}% of $${Math.ceil(record.income_amount)})`,
      reference_id: titheRecordId,
      created_by: user.id,
    })
    if (titheErr) {
      // Reverse the income transaction to avoid partial state
      await serviceSupabase.from('transactions')
        .delete()
        .eq('child_id', user.id)
        .eq('reference_id', record.checklist_id ?? record.id)
        .eq('type', txType)
      return NextResponse.json({ error: 'Failed to record tithe. Please try again.' }, { status: 500 })
    }
  }

  // Mark tithe record complete (safe to retry if this previously failed)
  await serviceSupabase.from('tithe_records').update({
    tithe_amount: titheAmount,
    tithe_percentage: tithePct,
    completed: true,
  }).eq('id', titheRecordId)

  const net = Math.ceil(record.income_amount - titheAmount)
  return NextResponse.json({ ok: true, net })
}
