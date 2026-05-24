'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { WithdrawalRequest, SpendingCategory } from '@/lib/types'

function formatMoney(n: number) {
  return '$' + Math.ceil(n).toLocaleString()
}

type WRWithStatus = WithdrawalRequest

export default function WithdrawPage() {
  const supabase = createClient()
  const [balance, setBalance] = useState(0)
  const [categories, setCategories] = useState<SpendingCategory[]>([])
  const [requests, setRequests] = useState<WRWithStatus[]>([])
  const [form, setForm] = useState({ amount: '', category: '', reason: '' })
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: profile }, { data: cat }, { data: reqs }] = await Promise.all([
      supabase.from('profiles').select('balance').eq('id', user.id).single(),
      supabase.from('spending_categories').select('*').eq('active', true).order('sort_order'),
      supabase.from('withdrawal_requests').select('*').eq('child_id', user.id).order('created_at', { ascending: false }).limit(20),
    ])

    setBalance(profile?.balance ?? 0)
    setCategories(cat ?? [])
    setRequests(reqs ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function submitRequest() {
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) { setMsg('Enter a valid amount'); return }
    if (!form.category) { setMsg('Pick a category'); return }
    if (amount > balance) { setMsg("You don't have enough savings for this"); return }

    setSubmitting(true)
    const { data: { user } } = await supabase.auth.getUser()

    const { error } = await supabase.from('withdrawal_requests').insert({
      child_id: user!.id,
      amount,
      category: form.category,
      reason: form.reason.trim() || '',
      status: 'pending',
    })

    if (error) { setMsg(error.message); setSubmitting(false); return }

    setMsg('Request sent! Waiting for parent approval.')
    setForm({ amount: '', category: '', reason: '' })
    load()
    setSubmitting(false)
    setTimeout(() => setMsg(''), 4000)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#94a3b8' }}>
      Loading...
    </div>
  )

  const hasPending = requests.some(r => r.status === 'pending')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Balance */}
      <div style={{
        background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
        borderRadius: '1.5rem',
        padding: '1.5rem',
        color: 'white',
        display: 'flex', alignItems: 'center', gap: '1rem',
      }}>
        <span style={{ fontSize: '2.5rem' }}>🏧</span>
        <div>
          <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>Available to spend</div>
          <div style={{ fontSize: '2rem', fontWeight: 800 }}>{formatMoney(balance)}</div>
        </div>
      </div>

      {/* Request form */}
      <div className="card">
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.1rem', fontWeight: 700 }}>
          💵 Request Money
        </h2>

        {hasPending && (
          <div style={{
            background: '#fff7ed', border: '1px solid #fed7aa',
            borderRadius: '0.75rem', padding: '0.875rem',
            fontSize: '0.875rem', color: '#c2410c', marginBottom: '1rem',
          }}>
            You already have a pending request. Wait for parent approval before making another.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label className="label">Amount ($)</label>
            <input
              className="input"
              type="number"
              min="0.01"
              step="1"
              max={balance}
              placeholder="How much do you need?"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Category</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setForm(f => ({ ...f, category: cat.name }))}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '999px',
                    border: '2px solid',
                    borderColor: form.category === cat.name ? '#2563eb' : '#e2e8f0',
                    background: form.category === cat.name ? '#dbeafe' : 'white',
                    color: form.category === cat.name ? '#1d4ed8' : '#64748b',
                    fontWeight: form.category === cat.name ? 700 : 400,
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    transition: 'all 0.15s',
                  }}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">More details <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span></label>
            <input
              className="input"
              placeholder="Any extra info for the record..."
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
            />
          </div>

          {msg && (
            <div style={{
              background: msg.includes('sent') ? '#dcfce7' : '#fee2e2',
              color: msg.includes('sent') ? '#15803d' : '#991b1b',
              padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.875rem'
            }}>
              {msg}
            </div>
          )}

          <button
            className="btn-primary"
            onClick={submitRequest}
            disabled={submitting || hasPending}
            style={{ width: '100%', fontSize: '1rem', padding: '0.875rem' }}
          >
            {submitting ? 'Sending...' : 'Send Request to Parents'}
          </button>
        </div>
      </div>

      {/* My requests */}
      <div className="card">
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700 }}>My Requests</h2>
        {requests.length === 0 ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', padding: '1.5rem 0', fontSize: '0.9rem' }}>
            No requests yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {requests.map(req => (
              <div key={req.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.875rem 0',
                borderBottom: '1px solid #f1f5f9',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.1rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{req.category}</span>
                    {req.reason && <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{req.reason}</span>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                    {new Date(req.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: '#dc2626', flexShrink: 0 }}>{formatMoney(req.amount)}</div>
                <span style={{
                  background: req.status === 'pending' ? '#fef3c7' : req.status === 'approved' ? '#dcfce7' : '#fee2e2',
                  color: req.status === 'pending' ? '#b45309' : req.status === 'approved' ? '#15803d' : '#b91c1c',
                  fontSize: '0.75rem', fontWeight: 600,
                  padding: '0.2rem 0.6rem', borderRadius: '999px',
                  flexShrink: 0,
                }}>
                  {req.status === 'pending' ? '⏳ Waiting' : req.status === 'approved' ? '✅ Approved' : '❌ Denied'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
