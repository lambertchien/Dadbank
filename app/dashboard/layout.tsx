import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import ChildNav from '@/components/ChildNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use service client to bypass RLS for role check
  const serviceSupabase = await createServiceClient()
  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('name, role, balance')
    .eq('id', user.id)
    .single()

  if (profile?.role === 'admin') redirect('/admin')

  return (
    <div style={{ minHeight: '100vh', background: '#f0fdf4' }}>
      <ChildNav name={profile?.name ?? ''} balance={profile?.balance ?? 0} />
      <main style={{ maxWidth: '680px', margin: '0 auto', padding: '1.5rem 1rem' }}>
        {children}
      </main>
    </div>
  )
}
