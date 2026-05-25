import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const serverSupabase = await createServerClient()
  const { data: { user } } = await serverSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: admin } = await serverSupabase.from('profiles').select('role').eq('id', user.id).single()
  if (admin?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { childId, password } = await req.json()
  if (!childId || !password) return NextResponse.json({ error: 'Missing childId or password' }, { status: 400 })
  if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })

  const serviceSupabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: child } = await serviceSupabase.from('profiles').select('role').eq('id', childId).single()
  if (!child || child.role !== 'child') return NextResponse.json({ error: 'Not a child account' }, { status: 400 })

  const { error } = await serviceSupabase.auth.admin.updateUserById(childId, { password })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
