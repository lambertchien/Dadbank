import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const serverSupabase = await createServerClient()
  const { data: { user } } = await serverSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: admin } = await serverSupabase.from('profiles').select('role').eq('id', user.id).single()
  if (admin?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email, password, starting_balance } = await req.json()
  if (!name || !email || !password) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Create auth user
  const { data: newUser, error: authError } = await serviceSupabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

  const balance = parseFloat(starting_balance) || 0

  // Create profile
  const { error: profileError } = await serviceSupabase.from('profiles').insert({
    id: newUser.user.id,
    name,
    role: 'child',
    balance,
    starting_balance: balance,
  })

  if (profileError) {
    await serviceSupabase.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: profileError.message }, { status: 400 })
  }

  // Record starting balance as a deposit transaction if > 0
  if (balance > 0) {
    await serviceSupabase.from('transactions').insert({
      child_id: newUser.user.id,
      amount: balance,
      type: 'deposit',
      description: 'Starting balance',
      created_by: user.id,
    })
    // Undo the trigger double-count (trigger already added it to balance set at insert)
    await serviceSupabase.from('profiles').update({ balance }).eq('id', newUser.user.id)
  }

  return NextResponse.json({ success: true, childId: newUser.user.id })
}
