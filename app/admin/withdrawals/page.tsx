'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WithdrawalRequest, Profile } from '@/lib/types'

function formatMoney(n: number) {
  return '$' + Math.ceil(n).toLocaleString()
}

type WRWithProfile = WithdrawalRequest & { profiles: { name: string; balance: number } }

export default function WithdrawalsPage() {
  const supabase = createClient()
  const [pending, setPending] = useState<WRWithProfile[]>([])
  const [history, setHistory] = useState<WRWithProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const [{ data: p }, { data: h }] = await Promise.all([
      supabase
        .from('withdrawal_requests')
        .select('*, profiles(name, balance)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
      supabase
        .from('withdrawal_requests')
        .select('*, profiles(name, balance)')
        .neq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    setPending(p as WRWithProfile[] ?? [])
    setHistory(h as WRWithProfile[] ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function decide(wr: WRWithProfile, approve: boolean) {
    setActing(wr.id)
    const { data: { user } } = await supabase.auth.getUser()

    let txId: string | null = null
    if (approve) {
      const { data: tx } = await supabase.from('transactions').insert({
        child_id: wr.child_id,
        amount: -Math.abs(wr.amount),
        type: 'withdrawal',
        category: wr.category,
        description: wr.reason,
        reference_id: wr.id,
        created_by: user?.id,
      }).select('id').single()
      txId = tx?.id ?? null
    }

    await supabase.from('withdrawal_requests').update({
      status: approve ? 'approved' : 'denied',
      decided_by: user?.id,
      decided_at: new Date().toISOString(),
      transaction_id: txId,
    }).eq('id', wr.id)

    setMsg(approve ? `Approved ${formatMoney(wr.amount)} for ${wr.profiles.name}` : `Denied request from ${wr.profiles.name}`)
    load()
    setActing(null)
    setTimeout(() => setMsg(''), 3000)
  }

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Withdrawal Requests</h1>
        <p style={{ color: '#64748b', marginTop: '0.25rem', fontSize: '0.9rem' }}>Review and approve spending requests</p>
      </div>

      {msg && (
        <div style={{ background: '#dcfce7', color: '#15803d', padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.875rem' }}>
          {msg}
        </div>
      )}

      {/* Pending */}
      <div className="card">
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700 }}>
          Pending
          {pending.length > 0 && (
            <span style={{
              background: '#fee2e2', color: '#b91c1c',
              fontSize: '0.75rem', fontWeight: 700,
              padding: '0.2rem 0.6rem', borderRadius: '999px',
              marginLeft: '0.5rem',
            }}>{pending.length}</span>
          )}
        </h2>

        {pending.length === 0 ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', padding: '2rem 0' }}>No pending requests. All clear!</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {pending.map(wr => (
              <div key={wr.id} style={{
                background: '#fffbeb', border: '1px solid #fde68a',
                borderRadius: '0.75rem', padding: '1rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>{wr.profiles?.name}</span>
                      <span style={{
                        background: '#dbeafe', color: '#1d4ed8',
                        fontSize: '0.75rem', fontWeight: 600,
                        padding: '0.15rem 0.5rem', borderRadius: '999px',
                      }}>{wr.category}</span>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {new Date(wr.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#374151', marginBottom: '0.25rem' }}>
                      <strong>Reason:</strong> {wr.reason}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      Current balance: {formatMoney(wr.profiles?.balance ?? 0)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>
                      {formatMoney(wr.amount)}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button
                        className="btn-danger"
                        style={{ padding: '0.375rem 0.875rem', fontSize: '0.85rem' }}
                        onClick={() => decide(wr, false)}
                        disabled={acting === wr.id}
                      >
                        Deny
                      </button>
                      <button
                        className="btn-primary"
                        style={{ padding: '0.375rem 0.875rem', fontSize: '0.85rem' }}
                        onClick={() => decide(wr, true)}
                        disabled={acting === wr.id || wr.amount > (wr.profiles?.balance ?? 0)}
                      >
                        {acting === wr.id ? '...' : 'Approve'}
                      </button>
                    </div>
                    {wr.amount > (wr.profiles?.balance ?? 0) && (
                      <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.25rem' }}>Insufficient balance</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <div className="card">
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700 }}>Recent History</h2>
        {history.length === 0 ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', padding: '2rem 0' }}>No history yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {history.map(wr => (
              <div key={wr.id} style={{
                display: 'flex', alignItems: 'center', gap: '1rem',
                padding: '0.75rem 0',
                borderBottom: '1px solid #f1f5f9',
                flexWrap: 'wrap',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600 }}>{wr.profiles?.name}</span>
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{wr.category}</span>
                  </div>
                  <div style={{ fontSize: '0.825rem', color: '#64748b' }}>{wr.reason}</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{new Date(wr.created_at).toLocaleDateString()}</div>
                </div>
                <div style={{ fontWeight: 700, color: '#dc2626' }}>{formatMoney(wr.amount)}</div>
                <span style={{
                  background: wr.status === 'approved' ? '#dcfce7' : '#fee2e2',
                  color: wr.status === 'approved' ? '#15803d' : '#b91c1c',
                  fontSize: '0.75rem', fontWeight: 600,
                  padding: '0.2rem 0.6rem', borderRadius: '999px',
                }}>
                  {wr.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
