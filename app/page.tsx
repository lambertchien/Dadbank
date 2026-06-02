import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') redirect('/admin')

  const { data: pendingTithe } = await supabase
    .from('tithe_records')
    .select('id')
    .eq('child_id', user.id)
    .eq('completed', false)
    .limit(1)
    .maybeSingle()

  redirect(pendingTithe ? '/dashboard' : '/dashboard/tasks')
}
