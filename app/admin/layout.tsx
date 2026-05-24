import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import AdminNav from '@/components/AdminNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Use service client to bypass RLS for role check
  const serviceSupabase = await createServiceClient()
  const { data: profile } = await serviceSupabase
    .from('profiles')
    .select('name, role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') redirect('/dashboard')

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <AdminNav adminName={profile.name} />
      <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '2rem 1rem' }}>
        {children}
      </main>
    </div>
  )
}
