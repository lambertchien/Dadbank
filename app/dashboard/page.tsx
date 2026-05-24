'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Transaction, Profile } from '@/lib/types'

function formatMoney(n: number) {
  return '$' + Math.ceil(n).toLocaleString()
}

const TX_STYLES: Record<string, { bg: string; color: string; label: string; emoji: string }> = {
  allowance:  { bg: '#dcfce7', color: '#15803d', label: 'Allowance', emoji: '💰' },
  interest:   { bg: '#dbeafe', color: '#1d4ed8', label: 'Interest', emoji: '📈' },
  tithe:      { bg: '#ede9fe', color: '#7c3aed', label: 'Tithe', emoji: '🙏' },
  withdrawal: { bg: '#fee2e2', color: '#b91c1c', label: 'Spending', emoji: '🛍️' },
  deposit:    { bg: '#d1fae5', color: '#065f46', label: 'Deposit', emoji: '🎁' },
  adjustment: { bg: '#f1f5f9', color: '#475569', label: 'Adjustment', emoji: '📝' },
}

interface TitheRecord {
  id: string
  income_amount: number
  tithe_amount: number
  tithe_percentage: number
  completed: boolean
  checklist_id: string
}

export default function DashboardPage() {
  const supabase = createClient()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [pendingTithe, setPendingTithe] = useState<TitheRecord | null>(null)
  const [titheInput, setTitheInput] = useState('')
  const [tithePct, setTithePct] = useState(10)
  const [defaultTithePct, setDefaultTithePct] = useState(10)
  const [submittingTithe, setSubmittingTithe] = useState(false)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [allowanceAmount, setAllowanceAmount] = useState(0)
  const [filterType, setFilterType] = useState('')
  const [timeSpan, setTimeSpan] = useState(0)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: p }, { data: tx }, { data: tithe }, { data: settings }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('transactions').select('*').eq('child_id', user.id).order('created_at', { ascending: false }).limit(200),
      supabase.from('tithe_records').select('*').eq('child_id', user.id).eq('completed', false).order('created_at', { ascending: false }).limit(1),
      supabase.from('app_settings').select('value').eq('key', 'tithe_percentage').single(),
    ])

    setProfile(p)
    setTransactions(tx ?? [])
    const t = tithe?.[0] ?? null
    setPendingTithe(t)
    const pct = parseFloat(settings?.value ?? '10')
    setDefaultTithePct(pct)
    if (t) {
      setTitheInput(String(Math.ceil(t.tithe_amount)))
      setTithePct(t.tithe_percentage)
      // Get allowance portion from linked checklist
      if (t.checklist_id) {
        const { data: cl } = await supabase
          .from('weekly_checklists')
          .select('base_amount, extra_amount')
          .eq('id', t.checklist_id)
          .single()
        setAllowanceAmount(cl ? (cl.base_amount + cl.extra_amount) : t.income_amount)
      } else {
        setAllowanceAmount(t.income_amount)
      }
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  function handleTitheAmountChange(val: string) {
    setTitheInput(val)
    if (pendingTithe && val) {
      const amt = parseFloat(val)
      const pct = (amt / pendingTithe.income_amount) * 100
      setTithePct(Math.ceil(pct * 10) / 10)
    }
  }

  function handleTithePctChange(val: number) {
    setTithePct(val)
    if (pendingTithe) {
      const amt = String(Math.ceil(pendingTithe.income_amount * val / 100))
      setTitheInput(amt)
    }
  }

  async function submitTithe() {
    if (!pendingTithe || !profile) return
    const amount = parseFloat(titheInput)
    if (isNaN(amount) || amount < (pendingTithe.income_amount * defaultTithePct / 100)) {
      setMsg(`Tithe must be at least ${defaultTithePct}% (${formatMoney(pendingTithe.income_amount * defaultTithePct / 100)})`)
      return
    }

    setSubmittingTithe(true)
    const net = Math.ceil(pendingTithe.income_amount - amount)

    const res = await fetch('/api/tithe/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titheRecordId: pendingTithe.id, titheAmount: amount, tithePct }),
    })

    if (!res.ok) {
      const json = await res.json()
      setMsg(json.error ?? 'Something went wrong')
      setSubmittingTithe(false)
      return
    }

    setMsg(`Tithe given! ${formatMoney(net)} added to your savings. Well done! 🎉`)
    setPendingTithe(null)
    load()
    setSubmittingTithe(false)
    setTimeout(() => setMsg(''), 3000)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#94a3b8', fontSize: '1.1rem' }}>
      Loading your account...
    </div>
  )

  const minTithe = pendingTithe ? pendingTithe.income_amount * defaultTithePct / 100 : 0
  const titheAmount = parseFloat(titheInput) || 0
  const titheValid = titheAmount >= minTithe

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Balance card */}
      <div style={{
        background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
        borderRadius: '1.5rem',
        padding: '2rem',
        color: 'white',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '0.9rem', opacity: 0.85, marginBottom: '0.5rem' }}>My Savings</div>
        <div style={{ fontSize: '3.5rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
          {formatMoney(profile?.balance ?? 0)}
        </div>
        <div style={{ fontSize: '0.85rem', opacity: 0.75, marginTop: '0.5rem' }}>
          Hi {profile?.name}! Keep it up 🌟
        </div>
      </div>

      {/* Tithe box — shown when there's a pending tithe */}
      {pendingTithe && (
        <div style={{
          background: 'white',
          borderRadius: '1.25rem',
          padding: '1.5rem',
          border: '2px solid #c4b5fd',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🙏</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{pendingTithe.checklist_id ? 'Allowance Ready!' : 'Deposit Ready!'}</div>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                Decide your tithe to receive your money
              </div>
            </div>
          </div>

          {/* Income breakdown */}
          <div style={{
            background: '#f8fafc', borderRadius: '0.75rem', padding: '0.875rem', marginBottom: '1.25rem',
          }}>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{pendingTithe.checklist_id ? 'Allowance' : 'Deposit'}</div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '1.1rem' }}>{formatMoney(allowanceAmount)}</div>
              </div>
              {pendingTithe.income_amount > allowanceAmount && (
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Interest</div>
                  <div style={{ fontWeight: 700, color: '#2563eb', fontSize: '1.1rem' }}>+{formatMoney(pendingTithe.income_amount - allowanceAmount)}</div>
                </div>
              )}
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Tithe Base</div>
                <div style={{ fontWeight: 700, color: '#7c3aed', fontSize: '1.1rem' }}>{formatMoney(pendingTithe.income_amount)}</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>You Keep</div>
                <div style={{ fontWeight: 700, color: '#16a34a', fontSize: '1.1rem' }}>{formatMoney(Math.max(0, pendingTithe.income_amount - titheAmount))}</div>
              </div>
            </div>
            {pendingTithe.income_amount > allowanceAmount && (
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.5rem', textAlign: 'center' }}>
                Interest earned this month is included in your tithe base
              </div>
            )}
          </div>

          {/* Tithe bar */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <span style={{ fontWeight: 700, color: '#7c3aed', fontSize: '1rem' }}>{formatMoney(titheAmount)}</span>
              <span style={{ fontWeight: 600, color: '#7c3aed', fontSize: '0.875rem' }}>{tithePct.toFixed(1)}%</span>
            </div>
            <div style={{ height: '14px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(tithePct, 100)}%`,
                background: 'linear-gradient(90deg, #7c3aed, #a78bfa)',
                borderRadius: '999px',
                transition: 'width 0.2s ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', marginTop: '0.3rem' }}>
              <span style={{ color: '#7c3aed', fontWeight: 600 }}>Min {defaultTithePct}%</span>
              <span style={{ color: '#94a3b8' }}>100%</span>
            </div>
          </div>

          {/* Amount input */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <label className="label">Tithe Amount ($)</label>
              <input
                className="input"
                type="number"
                min={Math.ceil(minTithe)}
                step="1"
                value={titheInput}
                onChange={e => handleTitheAmountChange(e.target.value)}
                style={{ borderColor: titheValid ? '#c4b5fd' : '#fca5a5' }}
              />
            </div>
            <button
              onClick={submitTithe}
              disabled={submittingTithe || !titheValid}
              style={{
                marginTop: '1.5rem',
                background: '#7c3aed',
                color: 'white',
                border: 'none',
                borderRadius: '0.75rem',
                padding: '0.625rem 1.25rem',
                fontWeight: 600,
                cursor: titheValid ? 'pointer' : 'not-allowed',
                opacity: titheValid ? 1 : 0.5,
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
            >
              {submittingTithe ? 'Submitting...' : 'Give Tithe'}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div style={{
          background: '#dcfce7', color: '#15803d',
          padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.875rem'
        }}>
          {msg}
        </div>
      )}

      {/* Transaction history */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>My Transactions</h2>
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            {([{ v: 3, label: '3M' }, { v: 6, label: '6M' }, { v: 0, label: 'All' }] as const).map(({ v, label }) => (
              <button key={v} onClick={() => setTimeSpan(v)} style={{
                padding: '0.25rem 0.625rem', borderRadius: '999px', border: '1.5px solid',
                borderColor: timeSpan === v ? '#16a34a' : '#e2e8f0',
                background: timeSpan === v ? '#dcfce7' : 'white',
                color: timeSpan === v ? '#15803d' : '#94a3b8',
                fontSize: '0.75rem', fontWeight: timeSpan === v ? 700 : 400,
                cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* Type filter bubbles */}
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {[{ key: '', label: 'All' }, ...Object.entries(TX_STYLES).map(([key, s]) => ({ key, label: s.label }))].map(({ key, label }) => {
            const active = filterType === key
            const style = key ? TX_STYLES[key] : null
            return (
              <button key={key} onClick={() => setFilterType(key)} style={{
                padding: '0.3rem 0.75rem', borderRadius: '999px', border: '1.5px solid',
                borderColor: active ? (style?.color ?? '#16a34a') : '#e2e8f0',
                background: active ? (style?.bg ?? '#dcfce7') : 'white',
                color: active ? (style?.color ?? '#15803d') : '#64748b',
                fontSize: '0.8rem', fontWeight: active ? 700 : 400,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>{label}</button>
            )
          })}
        </div>

        {(() => {
          const cutoff = timeSpan > 0 ? new Date(Date.now() - timeSpan * 30 * 24 * 60 * 60 * 1000) : null
          const filtered = transactions.filter(tx =>
            (!filterType || tx.type === filterType) &&
            (!cutoff || new Date(tx.created_at) >= cutoff)
          )
          const showSum = (filterType !== '' || timeSpan !== 0) && filtered.length > 0
          const net = showSum ? filtered.reduce((s, tx) => s + tx.amount, 0) : 0
          const sumStyle = filterType ? TX_STYLES[filterType] : null

          // Compute running balance: newest tx has balance = current balance
          // Each older tx: subtract the newer tx's amount
          const currentBalance = profile?.balance ?? 0
          const balanceAfter: number[] = []
          let running = currentBalance
          for (let i = 0; i < transactions.length; i++) {
            balanceAfter[i] = running
            running -= transactions[i].amount
          }
          // Map filtered tx back to their balanceAfter using index in full list
          const balanceMap = new Map(transactions.map((tx, i) => [tx.id, balanceAfter[i]]))

          if (filtered.length === 0) return (
            <p style={{ color: '#94a3b8', textAlign: 'center', padding: '2rem 0' }}>
              {transactions.length === 0 ? 'No transactions yet. Your allowance is coming!' : 'No transactions match this filter.'}
            </p>
          )
          return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {showSum && (
                <div style={{
                  background: sumStyle?.bg ?? '#f8fafc',
                  border: `1px solid ${sumStyle ? sumStyle.color + '33' : '#e2e8f0'}`,
                  borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{filtered.length} transaction{filtered.length !== 1 ? 's' : ''}</span>
                  <span style={{ fontWeight: 700, fontSize: '1rem', color: net >= 0 ? '#15803d' : '#dc2626' }}>
                    {net >= 0 ? '+' : ''}{formatMoney(net)}
                  </span>
                </div>
              )}
              {filtered.map(tx => {
                const style = TX_STYLES[tx.type] ?? TX_STYLES.adjustment
                const bal = balanceMap.get(tx.id)
                return (
                  <div key={tx.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.875rem 0',
                    borderBottom: '1px solid #f1f5f9',
                  }}>
                    <div style={{
                      width: '40px', height: '40px',
                      background: style.bg, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1.1rem', flexShrink: 0,
                    }}>
                      {style.emoji}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.1rem', flexWrap: 'wrap' }}>
                        <span style={{
                          background: style.bg, color: style.color,
                          fontSize: '0.7rem', fontWeight: 700,
                          padding: '0.1rem 0.45rem', borderRadius: '999px',
                        }}>{style.label}</span>
                        {tx.category && <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{tx.category}</span>}
                      </div>
                      <div style={{ fontSize: '0.875rem', color: '#374151' }}>{tx.description}</div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.1rem' }}>
                        {new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {bal !== undefined && <span style={{ marginLeft: '0.5rem' }}>· Balance: {formatMoney(bal)}</span>}
                      </div>
                    </div>
                    <div style={{
                      fontWeight: 700, fontSize: '1rem',
                      color: tx.amount >= 0 ? '#16a34a' : '#dc2626',
                      flexShrink: 0,
                    }}>
                      {tx.amount >= 0 ? '+' : ''}{formatMoney(tx.amount)}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
