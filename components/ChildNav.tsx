'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ChildNav({ name }: { name: string }) {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const links = [
    { href: '/dashboard', label: 'My Bank', emoji: '🏦' },
    { href: '/dashboard/withdraw', label: 'Get Money', emoji: '💵' },
    { href: '/dashboard/settings', label: 'Settings', emoji: '⚙️' },
  ]

  return (
    <nav style={{
      background: 'white',
      borderBottom: '1px solid #dcfce7',
      padding: '0 1rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 0.5rem', marginRight: '0.5rem' }}>
        <span style={{ fontSize: '1.25rem' }}>🏦</span>
        <span style={{ fontWeight: 700, color: '#16a34a', fontSize: '1rem' }}>DadBank</span>
      </div>

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
          }}>
            <span>{link.emoji}</span>
            {link.label}
          </Link>
        )
      })}

      <div style={{ flex: 1 }} />

      <span style={{ fontSize: '0.875rem', color: '#64748b' }}>{name}</span>

      <button onClick={signOut} className="btn-secondary" style={{ padding: '0.375rem 0.75rem', fontSize: '0.78rem', marginLeft: '0.25rem' }}>
        Sign out
      </button>
    </nav>
  )
}
