import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function DELETE(req: Request) {
  const serverSupabase = await createServerClient()
  const { data: { user } } = await serverSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: admin } = await serverSupabase.from('profiles').select('role').eq('id', user.id).single()
  if (admin?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { childId } = await req.json()
  if (!childId) return NextResponse.json({ error: 'Missing childId' }, { status: 400 })

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: child } = await serviceSupabase.from('profiles').select('role').eq('id', childId).single()
  if (!child || child.role !== 'child') return NextResponse.json({ error: 'Not a child account' }, { status: 400 })

  // Delete all child data manually in FK-safe order before removing the auth user.
  // Cannot rely on cascades alone because:
  //   - chore_assignments has no cascade
  //   - withdrawal_requests.transaction_id → transactions(id), no cascade
  //   - tithe_records.checklist_id → weekly_checklists(id), no cascade
  //   - transactions.created_by → auth.users(id), no cascade (child sets this on tithe submit)
  await serviceSupabase.from('chore_assignments').delete().eq('child_id', childId)
  await serviceSupabase.from('withdrawal_requests').delete().eq('child_id', childId)
  await serviceSupabase.from('tithe_records').delete().eq('child_id', childId)
  await serviceSupabase.from('transactions').delete().eq('child_id', childId)
  await serviceSupabase.from('weekly_checklists').delete().eq('child_id', childId)
  await serviceSupabase.from('profiles').delete().eq('id', childId)

  // auth.users row now has no FK references pointing to it
  const { error } = await serviceSupabase.auth.admin.deleteUser(childId)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
