'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Profile, ChoreTemplate, WeeklyChecklist, ChecklistItem, WithdrawalRequest, Transaction } from '@/lib/types'

function formatMoney(n: number) {
  return '$' + Math.ceil(n).toLocaleString()
}

function getThisSaturday() {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 6 ? 0 : (6 - day)
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

type ChecklistWithItems = WeeklyChecklist & { checklist_items: (ChecklistItem & { chore_templates: ChoreTemplate })[] }
type WRWithProfile = WithdrawalRequest & { profiles: { name: string; balance: number } }
type SectionKey = 'checklist' | 'withdrawals' | 'adjust' | 'history' | 'password'
type AdjustForm = { amount: string; description: string; type: 'deposit' | 'adjustment'; tithe: boolean }
type ManualTitheRecord = { id: string; income_amount: number; completed: boolean; description: string | null; created_at: string }

const TX_STYLES: Record<string, { bg: string; color: string; label: string; emoji: string }> = {
  allowance:  { bg: '#dcfce7', color: '#15803d', label: 'Allowance', emoji: '💰' },
  interest:   { bg: '#dbeafe', color: '#1d4ed8', label: 'Interest',  emoji: '📈' },
  tithe:      { bg: '#ede9fe', color: '#7c3aed', label: 'Tithe',     emoji: '🙏' },
  withdrawal: { bg: '#fee2e2', color: '#b91c1c', label: 'Spending',  emoji: '🛍️' },
  deposit:    { bg: '#d1fae5', color: '#065f46', label: 'Deposit',   emoji: '🎁' },
  adjustment: { bg: '#f1f5f9', color: '#475569', label: 'Adjustment',emoji: '📝' },
}

export default function ChildrenPage() {
  const supabase = createClient()
  const weekStart = getThisSaturday()

  const [children, setChildren] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const [activeSection, setActiveSection] = useState<Record<string, SectionKey | null>>({})

  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', starting_balance: '' })
  const [addChores, setAddChores] = useState<string[]>([])
  const [addingSaving, setAddingSaving] = useState(false)

  const [chores, setChores] = useState<ChoreTemplate[]>([])
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [checklists, setChecklists] = useState<Record<string, ChecklistWithItems>>({})
  const [completedTithes, setCompletedTithes] = useState<Set<string>>(new Set())
  const [defaultAllowance, setDefaultAllowance] = useState(100)
  const [defaultTithePct, setDefaultTithePct] = useState(10)
  const [checklistSaving, setChecklistSaving] = useState<string | null>(null)

  const [withdrawals, setWithdrawals] = useState<WRWithProfile[]>([])
  const [actingWR, setActingWR] = useState<string | null>(null)

  const [adjustForms, setAdjustForms] = useState<Record<string, AdjustForm>>({})
  const [adjustSaving, setAdjustSaving] = useState<string | null>(null)
  const [manualTithes, setManualTithes] = useState<Record<string, ManualTitheRecord[]>>({})

  const [childHistory, setChildHistory] = useState<Record<string, Transaction[]>>({})
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(new Set())
  const [historyFilters, setHistoryFilters] = useState<Record<string, { type: string; span: number }>>({})

  const [resetPasswords, setResetPasswords] = useState<Record<string, string>>({})
  const [resetSaving, setResetSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [{ data: ch }, { data: cr }, { data: cl }, { data: settings }, { data: titheSetting }, { data: wr }, { data: asgn }, { data: titheDone }, { data: manualTitheData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'child').order('name'),
      supabase.from('chore_templates').select('*').eq('active', true).order('type').order('sort_order'),
      supabase.from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('week_start', weekStart),
      supabase.from('app_settings').select('*').eq('key', 'default_allowance').single(),
      supabase.from('app_settings').select('value').eq('key', 'tithe_percentage').single(),
      supabase.from('withdrawal_requests').select('*, profiles(name, balance)').eq('status', 'pending').order('created_at', { ascending: true }),
      supabase.from('chore_assignments').select('child_id, chore_id'),
      supabase.from('tithe_records').select('checklist_id').eq('completed', true),
      supabase.from('tithe_records').select('id, child_id, income_amount, completed, description, created_at').is('checklist_id', null).order('created_at', { ascending: false }),
    ])

    setChildren(ch ?? [])
    setChores(cr ?? [])
    if (settings) setDefaultAllowance(parseFloat(settings.value))
    if (titheSetting) setDefaultTithePct(parseFloat(titheSetting.value))

    const clMap: Record<string, ChecklistWithItems> = {}
    for (const c of cl ?? []) clMap[c.child_id] = c as ChecklistWithItems
    setChecklists(clMap)

    setWithdrawals((wr as WRWithProfile[]) ?? [])

    const asgnMap: Record<string, string[]> = {}
    for (const a of asgn ?? []) {
      if (!asgnMap[a.child_id]) asgnMap[a.child_id] = []
      asgnMap[a.child_id].push(a.chore_id)
    }
    setAssignments(asgnMap)
    setCompletedTithes(new Set((titheDone ?? []).map(t => t.checklist_id).filter(Boolean)))

    const manualMap: Record<string, ManualTitheRecord[]> = {}
    for (const t of manualTitheData ?? []) {
      if (!manualMap[t.child_id]) manualMap[t.child_id] = []
      manualMap[t.child_id].push(t as ManualTitheRecord)
    }
    setManualTithes(manualMap)

    setLoading(false)
  }, [supabase, weekStart])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (loading || children.length === 0) return
    children.forEach(child => {
      const cl = checklists[child.id]
      const childChores = getChildChores(child.id)
      if (!cl || cl.checklist_items.length === 0) {
        ensureChecklist(child.id, childChores.length > 0 ? childChores : undefined)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, children])

  function getChildChores(childId: string): ChoreTemplate[] {
    const assigned = assignments[childId]
    if (assigned && assigned.length > 0) return chores.filter(c => assigned.includes(c.id))
    return []
  }

  async function ensureChecklist(childId: string, childChores?: ChoreTemplate[]): Promise<ChecklistWithItems> {
    if (checklists[childId]?.checklist_items.length > 0) return checklists[childId]
    const assigned = childChores ?? getChildChores(childId)
    const choresToUse = assigned.length > 0 ? assigned : chores

    const { data: existing } = await supabase
      .from('weekly_checklists')
      .select('*, checklist_items(*, chore_templates(*))')
      .eq('child_id', childId)
      .eq('week_start', weekStart)
      .single()

    if (existing) {
      if ((existing.checklist_items?.length ?? 0) === 0 && choresToUse.length > 0) {
        await supabase.from('checklist_items').insert(
          choresToUse.map(c => ({ checklist_id: existing.id, chore_id: c.id, checked: false, reward_earned: 0 }))
        )
        const { data: refilled } = await supabase
          .from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('id', existing.id).single()
        if (refilled) {
          setChecklists(prev => ({ ...prev, [childId]: refilled as ChecklistWithItems }))
          return refilled as ChecklistWithItems
        }
      }
      setChecklists(prev => ({ ...prev, [childId]: existing as ChecklistWithItems }))
      return existing as ChecklistWithItems
    }

    const { data: newCl } = await supabase
      .from('weekly_checklists')
      .insert({ child_id: childId, week_start: weekStart, base_amount: 0, extra_amount: 0 })
      .select().single()

    // If insert failed (race condition or RLS), try to fetch what's already there
    if (!newCl) {
      const { data: fallback } = await supabase
        .from('weekly_checklists')
        .select('*, checklist_items(*, chore_templates(*))')
        .eq('child_id', childId)
        .eq('week_start', weekStart)
        .single()
      if (fallback) {
        setChecklists(prev => ({ ...prev, [childId]: fallback as ChecklistWithItems }))
        return fallback as ChecklistWithItems
      }
      return checklists[childId]
    }

    if (choresToUse.length > 0) {
      await supabase.from('checklist_items').insert(
        choresToUse.map(c => ({ checklist_id: newCl.id, chore_id: c.id, checked: false, reward_earned: 0 }))
      )
    }

    const { data: full } = await supabase
      .from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('id', newCl.id).single()

    const result = full as ChecklistWithItems
    setChecklists(prev => ({ ...prev, [childId]: result }))
    return result
  }

  async function toggleItem(childId: string, itemId: string, chore: ChoreTemplate, checked: boolean) {
    const cl = await ensureChecklist(childId)
    await supabase.from('checklist_items').update({ checked, reward_earned: 0, count: 0 }).eq('id', itemId)
    const updatedItems = cl.checklist_items.map(i =>
      i.id === itemId ? { ...i, checked, reward_earned: 0, count: 0 } : i
    )
    const reqItems = updatedItems.filter(i => i.chore_templates?.type === 'required')
    const requiredAll = reqItems.length > 0 && reqItems.every(i => i.checked)
    const baseAmount = requiredAll ? defaultAllowance : 0
    const extraAmount = updatedItems.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    await supabase.from('weekly_checklists').update({ base_amount: baseAmount, extra_amount: extraAmount }).eq('id', cl.id)
    setChecklists(prev => ({
      ...prev,
      [childId]: { ...cl, base_amount: baseAmount, extra_amount: extraAmount, checklist_items: updatedItems } as ChecklistWithItems,
    }))
  }

  async function setExtraCount(childId: string, itemId: string, chore: ChoreTemplate, count: number) {
    const cl = await ensureChecklist(childId)
    const reward = count * (chore.reward_amount ?? 0)
    await supabase.from('checklist_items').update({ count, checked: count > 0, reward_earned: reward }).eq('id', itemId)
    const updatedItems = cl.checklist_items.map(i =>
      i.id === itemId ? { ...i, count, checked: count > 0, reward_earned: reward } : i
    )
    const reqItems = updatedItems.filter(i => i.chore_templates?.type === 'required')
    const requiredAll = reqItems.length > 0 && reqItems.every(i => i.checked)
    const baseAmount = requiredAll ? defaultAllowance : 0
    const extraAmount = updatedItems.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    await supabase.from('weekly_checklists').update({ base_amount: baseAmount, extra_amount: extraAmount }).eq('id', cl.id)
    setChecklists(prev => ({
      ...prev,
      [childId]: { ...cl, base_amount: baseAmount, extra_amount: extraAmount, checklist_items: updatedItems } as ChecklistWithItems,
    }))
  }

  async function approveAllowance(child: Profile) {
    setChecklistSaving(child.id)
    setMsg('')
    const cl = await ensureChecklist(child.id)
    const total = cl.base_amount + cl.extra_amount

    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('weekly_checklists').update({
      status: 'approved',
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', cl.id)

    if (total > 0) {
      const { data: settings } = await supabase.from('app_settings').select('value').eq('key', 'tithe_percentage').single()
      const pct = parseFloat(settings?.value ?? '10')

      const { data: lastTithe } = await supabase
        .from('tithe_records').select('created_at').eq('child_id', child.id).eq('completed', true)
        .order('created_at', { ascending: false }).limit(1).single()

      const since = lastTithe?.created_at ?? '1970-01-01'
      const { data: interestTx } = await supabase
        .from('transactions').select('amount').eq('child_id', child.id).eq('type', 'interest').gte('created_at', since)

      const interestAccrued = Math.ceil((interestTx ?? []).reduce((s, t) => s + t.amount, 0))
      const titheBase = total + interestAccrued
      const titheAmount = Math.ceil(titheBase * pct / 100)

      await supabase.from('tithe_records').insert({
        child_id: child.id,
        checklist_id: cl.id,
        income_amount: titheBase,
        tithe_amount: titheAmount,
        tithe_percentage: pct,
        completed: false,
      })
    }

    setMsg(`Allowance approved for ${child.name}!`)
    load()
    setChecklistSaving(null)
    setTimeout(() => setMsg(''), 3000)
  }

  async function decideWithdrawal(wr: WRWithProfile, approve: boolean) {
    setActingWR(wr.id)
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

    setMsg(approve ? `Approved ${formatMoney(wr.amount)}` : 'Request denied')
    load()
    setActingWR(null)
    setTimeout(() => setMsg(''), 3000)
  }

  async function applyAdjustment(child: Profile) {
    const form = adjustForms[child.id] ?? { amount: '', description: '', type: 'deposit', tithe: false }
    setAdjustSaving(child.id)
    setMsg('')

    const amount = parseFloat(form.amount)

    if (form.type === 'deposit' && form.tithe) {
      const { data: settings } = await supabase.from('app_settings').select('value').eq('key', 'tithe_percentage').single()
      const pct = parseFloat(settings?.value ?? '10')
      const { error } = await supabase.from('tithe_records').insert({
        child_id: child.id,
        checklist_id: null,
        income_amount: amount,
        tithe_amount: Math.ceil(amount * pct / 100),
        tithe_percentage: pct,
        completed: false,
        description: form.description || null,
      })
      if (error) { setMsg(error.message); setAdjustSaving(null); return }
      setMsg(`Deposit pending — ${child.name} will be asked to decide tithe`)
    } else {
      const finalAmount = form.type === 'deposit' ? Math.abs(amount) : -Math.abs(amount)
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('transactions').insert({
        child_id: child.id,
        amount: finalAmount,
        type: form.type,
        description: form.description || (form.type === 'deposit' ? 'Admin deposit' : 'Admin adjustment'),
        created_by: user?.id,
      })
      if (error) { setMsg(error.message); setAdjustSaving(null); return }
      setMsg('Done!')
    }

    setAdjustForms(prev => ({ ...prev, [child.id]: { amount: '', description: '', type: 'deposit', tithe: false } }))
    load()
    setAdjustSaving(null)
    setTimeout(() => setMsg(''), 3000)
  }

  async function loadHistory(childId: string) {
    if (childHistory[childId] !== undefined || historyLoading.has(childId)) return
    setHistoryLoading(prev => new Set(prev).add(childId))
    const { data } = await supabase
      .from('transactions').select('*')
      .eq('child_id', childId)
      .order('created_at', { ascending: false })
      .limit(200)
    setChildHistory(prev => ({ ...prev, [childId]: data ?? [] }))
    setHistoryLoading(prev => { const s = new Set(prev); s.delete(childId); return s })
  }

  async function resetPassword(child: Profile) {
    const password = resetPasswords[child.id] ?? ''
    if (password.length < 6) { setMsg('Password must be at least 6 characters'); return }
    setResetSaving(child.id)
    setMsg('')
    const res = await fetch('/api/admin/reset-child-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: child.id, password }),
    })
    const json = await res.json()
    if (!res.ok) { setMsg(json.error ?? 'Reset failed'); setResetSaving(null); return }
    setMsg(`Password updated for ${child.name}`)
    setResetPasswords(prev => ({ ...prev, [child.id]: '' }))
    setResetSaving(null)
    setTimeout(() => setMsg(''), 3000)
  }

  async function addChild() {
    setAddingSaving(true)
    setMsg('')
    try {
      const res = await fetch('/api/admin/create-child', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (addChores.length > 0) {
        await supabase.from('chore_assignments').insert(
          addChores.map(choreId => ({ child_id: json.childId, chore_id: choreId }))
        )
      }
      setMsg('Child account created!')
      setAddForm({ name: '', email: '', password: '', starting_balance: '' })
      setAddChores([])
      setShowAdd(false)
      load()
    } catch (e: unknown) {
      setMsg((e as Error).message)
    }
    setAddingSaving(false)
  }

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Children</h1>
          <p style={{ color: '#64748b', marginTop: '0.25rem', fontSize: '0.9rem' }}>
            Week of {new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(v => !v)}>
          {showAdd ? 'Cancel' : '+ Add Child'}
        </button>
      </div>

      {msg && (
        <div style={{
          background: msg.toLowerCase().includes('error') || msg.toLowerCase().includes('denied') ? '#fee2e2' : '#dcfce7',
          color: msg.toLowerCase().includes('error') || msg.toLowerCase().includes('denied') ? '#991b1b' : '#15803d',
          padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.875rem',
        }}>{msg}</div>
      )}

      {showAdd && (
        <div className="card">
          <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700 }}>New Child Account</h2>
          <div className="form-grid-2">
            <div>
              <label className="label">Name</label>
              <input className="input" placeholder="e.g. Max"
                value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Login username</label>
              <input className="input" placeholder="e.g. max@jz"
                value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" placeholder="Set a password"
                value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div>
              <label className="label">Starting Balance ($)</label>
              <input className="input" type="number" min="0" step="1" placeholder="0"
                value={addForm.starting_balance} onChange={e => setAddForm(f => ({ ...f, starting_balance: e.target.value }))} />
            </div>
          </div>
          {/* Chore assignment */}
          {chores.length > 0 && (
            <div style={{ marginTop: '1.25rem', borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Assign Chores</div>
              {(['required', 'extra'] as const).map(type => {
                const group = chores.filter(c => c.type === type)
                if (group.length === 0) return null
                return (
                  <div key={type} style={{ marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: type === 'required' ? '#1d4ed8' : '#d97706', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                      {type === 'required' ? 'Part 1 — Required' : 'Part 2 — Extra Rewards'}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                      {group.map(chore => (
                        <label key={chore.id} style={{
                          display: 'flex', alignItems: 'center', gap: '0.4rem',
                          padding: '0.35rem 0.75rem',
                          background: addChores.includes(chore.id) ? (type === 'required' ? '#dbeafe' : '#fef3c7') : '#f8fafc',
                          border: `1px solid ${addChores.includes(chore.id) ? (type === 'required' ? '#93c5fd' : '#fde68a') : '#e2e8f0'}`,
                          borderRadius: '999px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
                          color: addChores.includes(chore.id) ? (type === 'required' ? '#1d4ed8' : '#d97706') : '#64748b',
                          transition: 'all 0.15s',
                        }}>
                          <input
                            type="checkbox"
                            checked={addChores.includes(chore.id)}
                            onChange={e => setAddChores(prev =>
                              e.target.checked ? [...prev, chore.id] : prev.filter(id => id !== chore.id)
                            )}
                            style={{ accentColor: type === 'required' ? '#1d4ed8' : '#d97706', cursor: 'pointer' }}
                          />
                          {chore.name}{type === 'extra' ? ` (+${formatMoney(chore.reward_amount ?? 0)})` : ''}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '0.5rem 0 0' }}>
                If none selected, all active chores will be assigned.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button className="btn-primary" onClick={addChild} disabled={addingSaving}>
              {addingSaving ? 'Creating...' : 'Create Account'}
            </button>
            <button className="btn-secondary" onClick={() => { setShowAdd(false); setAddChores([]) }}>Cancel</button>
          </div>
        </div>
      )}

      {children.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👧</div>
          <p style={{ color: '#64748b' }}>No children accounts yet. Add your first child above.</p>
        </div>
      ) : (
        children.map(child => {
          const section = activeSection[child.id] ?? null
          const cl = checklists[child.id]
          const items = cl?.checklist_items ?? []
          const total = (cl?.base_amount ?? 0) + (cl?.extra_amount ?? 0)
          const approved = cl?.status === 'approved'
          const reqItems = items.filter(i => i.chore_templates?.type === 'required')
          const extraItems = items.filter(i => i.chore_templates?.type === 'extra')
          const reqAllChecked = reqItems.length > 0 && reqItems.every(i => i.checked)
          const childWithdrawals = withdrawals.filter(w => w.child_id === child.id)
          const adjustForm = adjustForms[child.id] ?? { amount: '', description: '', type: 'deposit' as const, tithe: false }

          const tabs = [
            {
              key: 'checklist' as SectionKey,
              label: '✅ Checklist',
              badge: approved ? null : total > 0 ? formatMoney(total) : null,
              badgeBg: '#dcfce7', badgeColor: '#15803d',
            },
            {
              key: 'withdrawals' as SectionKey,
              label: '💸 Withdrawals',
              badge: childWithdrawals.length > 0 ? String(childWithdrawals.length) : null,
              badgeBg: '#fee2e2', badgeColor: '#b91c1c',
            },
            {
              key: 'adjust' as SectionKey,
              label: '⚙️ Manual +/-',
              badge: null,
              badgeBg: '', badgeColor: '',
            },
            {
              key: 'history' as SectionKey,
              label: '📊 History',
              badge: null,
              badgeBg: '', badgeColor: '',
            },
            {
              key: 'password' as SectionKey,
              label: '🔑 Password',
              badge: null,
              badgeBg: '', badgeColor: '',
            },
          ]

          return (
            <div key={child.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {/* Child header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.5rem' }}>
                <div style={{
                  width: '52px', height: '52px',
                  background: '#dcfce7', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.5rem', fontWeight: 700, color: '#16a34a', flexShrink: 0,
                }}>
                  {child.name.charAt(0)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{child.name}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{child.email}</div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                  <div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: child.balance >= 0 ? '#16a34a' : '#dc2626' }}>
                      {formatMoney(child.balance)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>balance</div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete ${child.name}'s account and all their data? This cannot be undone.`)) return
                      const res = await fetch('/api/admin/delete-child', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ childId: child.id }),
                      })
                      if (res.ok) { setMsg(`${child.name}'s account deleted`); load() }
                      else { const j = await res.json(); setMsg(j.error ?? 'Delete failed') }
                    }}
                    style={{
                      fontSize: '0.7rem', color: '#dc2626', background: 'none',
                      border: '1px solid #fecaca', borderRadius: '0.5rem',
                      padding: '0.2rem 0.5rem', cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Section tabs */}
              <div className="tabs-row" style={{ borderTop: '1px solid #f1f5f9', borderBottom: section ? '1px solid #f1f5f9' : 'none' }}>
                {tabs.map((tab, i) => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveSection(prev => ({ ...prev, [child.id]: prev[child.id] === tab.key ? null : tab.key }))
                      if (tab.key === 'history') loadHistory(child.id)
                    }}
                    style={{
                      flex: 1, padding: '0.75rem 0.5rem',
                      background: section === tab.key ? '#f8fafc' : 'white',
                      border: 'none',
                      borderRight: i < tabs.length - 1 ? '1px solid #f1f5f9' : 'none',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      fontWeight: section === tab.key ? 700 : 400,
                      color: section === tab.key ? '#1e293b' : '#64748b',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                      transition: 'all 0.15s',
                    }}
                  >
                    {tab.label}
                    {tab.badge && (
                      <span style={{
                        background: tab.badgeBg, color: tab.badgeColor,
                        fontSize: '0.7rem', fontWeight: 700,
                        padding: '0.1rem 0.45rem', borderRadius: '999px',
                      }}>{tab.badge}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Checklist section */}
              {section === 'checklist' && (
                <div style={{ padding: '1.5rem' }}>
                  {approved ? (
                    !completedTithes.has(cl?.id ?? '') && (
                      <div style={{
                        background: '#fefce8', border: '1px solid #fde047',
                        borderRadius: '0.75rem', padding: '1rem',
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        color: '#854d0e', fontWeight: 600,
                      }}>
                        <span style={{ fontSize: '1.25rem' }}>⏳</span>
                        {`Allowance approved — ${formatMoney(total)} waiting for tithe decision`}
                      </div>
                    )
                  ) : (
                    <>
                      {/* Part 1: Required */}
                      <div style={{ marginBottom: '1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                          <span style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                            PART 1 — Required
                          </span>
                          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            All checked = {formatMoney(defaultAllowance)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {reqItems.map(item => {
                            const chore = item.chore_templates
                            if (!chore) return null
                            return (
                              <label key={item.id} style={{
                                display: 'flex', alignItems: 'center', gap: '0.75rem',
                                padding: '0.625rem 0.875rem',
                                background: item.checked ? '#f0fdf4' : '#f8fafc',
                                borderRadius: '0.625rem', cursor: 'pointer',
                                border: `1px solid ${item.checked ? '#bbf7d0' : '#e2e8f0'}`,
                                transition: 'all 0.15s',
                              }}>
                                <input type="checkbox" checked={item.checked}
                                  onChange={e => toggleItem(child.id, item.id, chore, e.target.checked)}
                                  style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#16a34a' }} />
                                <span style={{ fontWeight: 500, flex: 1 }}>{chore.name}</span>
                                {item.checked && <span style={{ color: '#16a34a', fontSize: '0.85rem', fontWeight: 600 }}>✓</span>}
                              </label>
                            )
                          })}
                          {reqItems.length === 0 && (
                            <p style={{ color: '#94a3b8', fontSize: '0.875rem', padding: '0.5rem 0' }}>
                              No required chores assigned. Go to Settings to assign chores.
                            </p>
                          )}
                        </div>
                        {reqAllChecked && (
                          <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#15803d', fontWeight: 600 }}>
                            ✅ All done! Base allowance: {formatMoney(defaultAllowance)}
                          </div>
                        )}
                      </div>

                      {/* Part 2: Extra */}
                      {extraItems.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <span style={{ background: '#fef3c7', color: '#d97706', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                              PART 2 — Extra Rewards
                            </span>
                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Optional bonus</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {extraItems.map(item => {
                              const chore = item.chore_templates
                              if (!chore) return null
                              const count = item.count ?? 0
                              const earned = count * (chore.reward_amount ?? 0)
                              return (
                                <div key={item.id} style={{
                                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                                  padding: '0.625rem 0.875rem',
                                  background: count > 0 ? '#fffbeb' : '#f8fafc',
                                  borderRadius: '0.625rem',
                                  border: `1px solid ${count > 0 ? '#fde68a' : '#e2e8f0'}`,
                                  transition: 'all 0.15s',
                                }}>
                                  <span style={{ fontWeight: 500, flex: 1 }}>{chore.name}</span>
                                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{formatMoney(chore.reward_amount ?? 0)}/session ×</span>
                                  <select
                                    value={count}
                                    onChange={e => setExtraCount(child.id, item.id, chore, parseInt(e.target.value))}
                                    style={{
                                      border: '1px solid #e2e8f0', borderRadius: '0.5rem',
                                      padding: '0.2rem 0.4rem', fontSize: '0.9rem',
                                      fontWeight: 700, cursor: 'pointer',
                                      background: count > 0 ? '#fef3c7' : '#f8fafc',
                                      color: count > 0 ? '#d97706' : '#64748b',
                                    }}
                                  >
                                    {Array.from({length: 16}, (_, n) => (
                                      <option key={n} value={n}>{n}</option>
                                    ))}
                                  </select>
                                  <span style={{
                                    background: count > 0 ? '#fef3c7' : '#f1f5f9',
                                    color: count > 0 ? '#d97706' : '#94a3b8',
                                    fontSize: '0.85rem', fontWeight: 700,
                                    padding: '0.2rem 0.6rem', borderRadius: '999px',
                                    minWidth: '3rem', textAlign: 'right',
                                  }}>+{formatMoney(earned)}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Summary + approve */}
                      <div style={{
                        background: '#f8fafc', borderRadius: '0.75rem',
                        padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                      }}>
                        <div style={{ flex: 1, display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Base</div>
                            <div style={{ fontWeight: 700 }}>{formatMoney(cl?.base_amount ?? 0)}</div>
                          </div>
                          {(cl?.extra_amount ?? 0) > 0 && (
                            <div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Extras</div>
                              <div style={{ fontWeight: 700, color: '#d97706' }}>{formatMoney(cl?.extra_amount ?? 0)}</div>
                            </div>
                          )}
                          <div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Total</div>
                            <div style={{ fontWeight: 700, color: '#16a34a', fontSize: '1.1rem' }}>{formatMoney(total)}</div>
                          </div>
                        </div>
                        <button
                          className="btn-primary"
                          onClick={() => approveAllowance(child)}
                          disabled={checklistSaving === child.id || total === 0}
                        >
                          {checklistSaving === child.id ? 'Approving...' : `Approve & Pay ${formatMoney(total)}`}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Withdrawals section */}
              {section === 'withdrawals' && (
                <div style={{ padding: '1.5rem' }}>
                  {childWithdrawals.length === 0 ? (
                    <p style={{ color: '#94a3b8', textAlign: 'center', padding: '1.5rem 0' }}>
                      No pending withdrawal requests.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {childWithdrawals.map(wr => (
                        <div key={wr.id} style={{
                          background: '#fffbeb', border: '1px solid #fde68a',
                          borderRadius: '0.75rem', padding: '1rem',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                                <span style={{
                                  background: '#dbeafe', color: '#1d4ed8',
                                  fontSize: '0.75rem', fontWeight: 600,
                                  padding: '0.15rem 0.5rem', borderRadius: '999px',
                                }}>{wr.category}</span>
                                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                  {new Date(wr.created_at).toLocaleDateString()}
                                </span>
                              </div>
                              {wr.reason && <div style={{ fontSize: '0.875rem', color: '#64748b' }}>{wr.reason}</div>}
                              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                                Balance: {formatMoney(child.balance)}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>
                                {formatMoney(wr.amount)}
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                <button className="btn-danger"
                                  style={{ padding: '0.375rem 0.875rem', fontSize: '0.85rem' }}
                                  onClick={() => decideWithdrawal(wr, false)}
                                  disabled={actingWR === wr.id}>Deny</button>
                                <button className="btn-primary"
                                  style={{ padding: '0.375rem 0.875rem', fontSize: '0.85rem' }}
                                  onClick={() => decideWithdrawal(wr, true)}
                                  disabled={actingWR === wr.id || wr.amount > child.balance}>
                                  {actingWR === wr.id ? '...' : 'Approve'}
                                </button>
                              </div>
                              {wr.amount > child.balance && (
                                <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.25rem' }}>
                                  Insufficient balance
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Adjust section */}
              {section === 'adjust' && (
                <div style={{ padding: '1.5rem' }}>
                  {/* Manual tithe status cards */}
                  {(manualTithes[child.id] ?? []).filter(r => !r.completed).length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
                      {(manualTithes[child.id] ?? []).filter(r => !r.completed).map(record => (
                        <div key={record.id} style={{
                          background: record.completed ? '#f0fdf4' : '#fefce8',
                          border: `1px solid ${record.completed ? '#bbf7d0' : '#fde047'}`,
                          borderRadius: '0.75rem', padding: '0.875rem 1rem',
                          display: 'flex', alignItems: 'center', gap: '0.75rem',
                        }}>
                          <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{record.completed ? '✅' : '⏳'}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, color: record.completed ? '#15803d' : '#854d0e', fontSize: '0.875rem' }}>
                              {record.completed ? 'Tithe given — net deposited' : `${formatMoney(record.income_amount)} waiting for tithe decision`}
                            </div>
                            {record.description && (
                              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem' }}>{record.description}</div>
                            )}
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                              {new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </div>
                          </div>
                          <div style={{ fontWeight: 700, color: record.completed ? '#15803d' : '#92400e', flexShrink: 0 }}>
                            {formatMoney(record.income_amount)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="form-grid-3">
                    <div>
                      <label className="label">Type</label>
                      <select className="input" value={adjustForm.type}
                        onChange={e => setAdjustForms(prev => ({
                          ...prev, [child.id]: { ...adjustForm, type: e.target.value as 'deposit' | 'adjustment' }
                        }))}>
                        <option value="deposit">Deposit (add money)</option>
                        <option value="adjustment">Deduction (remove money)</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Amount ($)</label>
                      <input className="input" type="number" min="0" step="1" placeholder="0"
                        value={adjustForm.amount}
                        onChange={e => setAdjustForms(prev => ({
                          ...prev, [child.id]: { ...adjustForm, amount: e.target.value }
                        }))} />
                    </div>
                    <div>
                      <label className="label">Reason</label>
                      <input className="input" placeholder="e.g. Birthday gift, penalty..."
                        value={adjustForm.description}
                        onChange={e => setAdjustForms(prev => ({
                          ...prev, [child.id]: { ...adjustForm, description: e.target.value }
                        }))} />
                    </div>
                  </div>
                  {adjustForm.type === 'deposit' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', cursor: 'pointer', fontSize: '0.875rem', color: '#374151' }}>
                      <input
                        type="checkbox"
                        checked={adjustForm.tithe}
                        onChange={e => setAdjustForms(prev => ({ ...prev, [child.id]: { ...adjustForm, tithe: e.target.checked } }))}
                        style={{ width: '16px', height: '16px', accentColor: '#7c3aed' }}
                      />
                      <span>🙏 Ask child to decide tithe (min {defaultTithePct}%)</span>
                    </label>
                  )}
                  <button className="btn-primary" style={{ marginTop: '1rem' }}
                    onClick={() => applyAdjustment(child)}
                    disabled={adjustSaving === child.id || !adjustForm.amount}>
                    {adjustSaving === child.id ? 'Applying...' : 'Apply'}
                  </button>
                </div>
              )}

              {/* Password section */}
              {section === 'password' && (
                <div style={{ padding: '1.5rem' }}>
                  <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: 0, marginBottom: '1rem' }}>
                    Set a new password for {child.name}. They&apos;ll use it next time they log in.
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <label className="label">New Password</label>
                      <input
                        className="input"
                        type="password"
                        placeholder="Min 6 characters"
                        value={resetPasswords[child.id] ?? ''}
                        onChange={e => setResetPasswords(prev => ({ ...prev, [child.id]: e.target.value }))}
                      />
                    </div>
                    <button
                      className="btn-primary"
                      onClick={() => resetPassword(child)}
                      disabled={resetSaving === child.id || (resetPasswords[child.id] ?? '').length < 6}
                    >
                      {resetSaving === child.id ? 'Saving...' : 'Set Password'}
                    </button>
                  </div>
                </div>
              )}

              {/* History section */}
              {section === 'history' && (() => {
                const hf = historyFilters[child.id] ?? { type: '', span: 0 }
                const cutoff = hf.span > 0 ? new Date(Date.now() - hf.span * 30 * 24 * 60 * 60 * 1000) : null
                const txList = (childHistory[child.id] ?? []).filter(tx =>
                  (!hf.type || tx.type === hf.type) &&
                  (!cutoff || new Date(tx.created_at) >= cutoff)
                )
                return (
                  <div style={{ padding: '1.5rem' }}>
                    {/* Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        {[{ key: '', label: 'All' }, ...Object.entries(TX_STYLES).map(([key, s]) => ({ key, label: s.label }))].map(({ key, label }) => {
                          const active = hf.type === key
                          const s = key ? TX_STYLES[key] : null
                          return (
                            <button key={key} onClick={() => setHistoryFilters(prev => ({ ...prev, [child.id]: { ...hf, type: key } }))} style={{
                              padding: '0.25rem 0.625rem', borderRadius: '999px', border: '1.5px solid',
                              borderColor: active ? (s?.color ?? '#16a34a') : '#e2e8f0',
                              background: active ? (s?.bg ?? '#dcfce7') : 'white',
                              color: active ? (s?.color ?? '#15803d') : '#64748b',
                              fontSize: '0.75rem', fontWeight: active ? 700 : 400,
                              cursor: 'pointer',
                            }}>{label}</button>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: '0.375rem' }}>
                        {([{ v: 3, label: '3M' }, { v: 6, label: '6M' }, { v: 0, label: 'All' }] as const).map(({ v, label }) => (
                          <button key={v} onClick={() => setHistoryFilters(prev => ({ ...prev, [child.id]: { ...hf, span: v } }))} style={{
                            padding: '0.25rem 0.625rem', borderRadius: '999px', border: '1.5px solid',
                            borderColor: hf.span === v ? '#16a34a' : '#e2e8f0',
                            background: hf.span === v ? '#dcfce7' : 'white',
                            color: hf.span === v ? '#15803d' : '#94a3b8',
                            fontSize: '0.75rem', fontWeight: hf.span === v ? 700 : 400,
                            cursor: 'pointer',
                          }}>{label}</button>
                        ))}
                      </div>
                    </div>

                    {/* Sum total */}
                    {!historyLoading.has(child.id) && txList.length > 0 && (hf.type !== '' || hf.span !== 0) && (() => {
                      const net = txList.reduce((s, tx) => s + tx.amount, 0)
                      const s = hf.type ? TX_STYLES[hf.type] : null
                      return (
                        <div style={{
                          background: s?.bg ?? '#f8fafc', border: `1px solid ${s ? s.color + '33' : '#e2e8f0'}`,
                          borderRadius: '0.75rem', padding: '0.75rem 1rem', marginBottom: '0.75rem',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{txList.length} transaction{txList.length !== 1 ? 's' : ''}</span>
                          <span style={{ fontWeight: 700, fontSize: '1rem', color: net >= 0 ? '#15803d' : '#dc2626' }}>
                            {net >= 0 ? '+' : ''}{formatMoney(net)}
                          </span>
                        </div>
                      )
                    })()}

                    {/* Transaction list */}
                    {historyLoading.has(child.id) ? (
                      <p style={{ color: '#94a3b8', textAlign: 'center', padding: '1.5rem 0' }}>Loading...</p>
                    ) : txList.length === 0 ? (
                      <p style={{ color: '#94a3b8', textAlign: 'center', padding: '1.5rem 0' }}>No transactions found.</p>
                    ) : (() => {
                      const allTx = childHistory[child.id] ?? []
                      const balanceAfter: number[] = []
                      let running = child.balance
                      for (let i = 0; i < allTx.length; i++) {
                        balanceAfter[i] = running
                        running -= allTx[i].amount
                      }
                      const balanceMap = new Map(allTx.map((tx, i) => [tx.id, balanceAfter[i]]))
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {txList.map(tx => {
                            const s = TX_STYLES[tx.type] ?? TX_STYLES.adjustment
                            const bal = balanceMap.get(tx.id)
                            return (
                              <div key={tx.id} style={{
                                display: 'flex', alignItems: 'center', gap: '0.75rem',
                                padding: '0.75rem 0', borderBottom: '1px solid #f1f5f9',
                              }}>
                                <div style={{
                                  width: '36px', height: '36px',
                                  background: s.bg, borderRadius: '50%',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: '1rem', flexShrink: 0,
                                }}>{s.emoji}</div>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.1rem', flexWrap: 'wrap' }}>
                                    <span style={{
                                      background: s.bg, color: s.color,
                                      fontSize: '0.7rem', fontWeight: 700,
                                      padding: '0.1rem 0.45rem', borderRadius: '999px',
                                    }}>{s.label}</span>
                                    {tx.category && <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{tx.category}</span>}
                                  </div>
                                  <div style={{ fontSize: '0.825rem', color: '#374151' }}>{tx.description}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.1rem' }}>
                                    {new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    {bal !== undefined && <span style={{ marginLeft: '0.5rem' }}>· Balance: {formatMoney(bal)}</span>}
                                  </div>
                                </div>
                                <div style={{
                                  fontWeight: 700, fontSize: '0.95rem',
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
                )
              })()}
            </div>
          )
        })
      )}
    </div>
  )
}
