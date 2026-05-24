'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const links = [
  { href: '/admin/children', label: 'Children', emoji: '👧' },
  { href: '/admin/settings', label: 'Settings', emoji: '⚙️' },
]

export default function AdminNav({ adminName }: { adminName: string }) {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <nav style={{
      background: 'white',
      borderBottom: '1px solid #e2e8f0',
      padding: '0 1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.25rem',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 0.5rem', marginRight: '1rem' }}>
        <span style={{ fontSize: '1.25rem' }}>🏦</span>
        <span style={{ fontWeight: 700, color: '#16a34a', fontSize: '1.1rem' }}>DadBank</span>
        <span className="hide-mobile" style={{
          background: '#dcfce7', color: '#15803d',
          fontSize: '0.7rem', fontWeight: 600,
          padding: '0.15rem 0.5rem', borderRadius: '999px', marginLeft: '0.25rem'
        }}>ADMIN</span>
      </div>

      <div style={{ display: 'flex', flex: 1, gap: '0.125rem' }}>
        {links.map(link => {
          const active = pathname === link.href
          return (
            <Link key={link.href} href={link.href} style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.5rem 0.875rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: active ? 600 : 400,
              color: active ? '#16a34a' : '#64748b',
              background: active ? '#f0fdf4' : 'transparent',
              textDecoration: 'none',
              transition: 'all 0.15s',
            }}>
              <span>{link.emoji}</span>
              <span className="hide-mobile">{link.label}</span>
            </Link>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 0' }}>
        <span className="hide-mobile" style={{ fontSize: '0.875rem', color: '#64748b' }}>{adminName}</span>
        <button onClick={signOut} className="btn-secondary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}>
          Sign out
        </button>
      </div>
    </nav>
  )
}
