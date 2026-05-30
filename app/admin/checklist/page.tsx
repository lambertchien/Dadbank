'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Profile, ChoreTemplate, WeeklyChecklist, ChecklistItem } from '@/lib/types'

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

export default function ChecklistPage() {
  const supabase = createClient()
  const [children, setChildren] = useState<Profile[]>([])
  const [chores, setChores] = useState<ChoreTemplate[]>([])
  const [checklists, setChecklists] = useState<Record<string, ChecklistWithItems>>({})
  const [defaultAllowance, setDefaultAllowance] = useState(100)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const weekStart = getThisSaturday()

  const load = useCallback(async () => {
    const [{ data: ch }, { data: cr }, { data: cl }, { data: settings }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'child').order('name'),
      supabase.from('chore_templates').select('*').eq('active', true).order('sort_order'),
      supabase.from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('week_start', weekStart),
      supabase.from('app_settings').select('*').eq('key', 'default_allowance').single(),
    ])
    setChildren(ch ?? [])
    setChores(cr ?? [])
    if (settings) setDefaultAllowance(parseFloat(settings.value))

    const clMap: Record<string, ChecklistWithItems> = {}
    for (const c of cl ?? []) clMap[c.child_id] = c as ChecklistWithItems
    setChecklists(clMap)
    setLoading(false)
  }, [supabase, weekStart])

  useEffect(() => { load() }, [load])

  // Auto-create checklists (and items) for all children when page loads
  useEffect(() => {
    if (loading || children.length === 0 || chores.length === 0) return
    children.forEach(child => {
      const cl = checklists[child.id]
      // Create if missing, or repopulate items if checklist exists but has no items
      if (!cl || cl.checklist_items.length === 0) ensureChecklist(child.id)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, children, chores])

  async function ensureChecklist(childId: string): Promise<ChecklistWithItems> {
    // Only use cache if it has items
    if (checklists[childId]?.checklist_items.length > 0) return checklists[childId]

    const { data: existing } = await supabase
      .from('weekly_checklists')
      .select('*, checklist_items(*, chore_templates(*))')
      .eq('child_id', childId)
      .eq('week_start', weekStart)
      .single()

    if (existing) {
      // Checklist exists but has no items — populate them
      if ((existing.checklist_items?.length ?? 0) === 0) {
        const activeChores = chores.filter(c => c.active)
        if (activeChores.length > 0) {
          await supabase.from('checklist_items').insert(
            activeChores.map(c => ({
              checklist_id: existing.id,
              chore_id: c.id,
              checked: false,
              reward_earned: 0,
            }))
          )
          // Reload with items
          const { data: refilled } = await supabase
            .from('weekly_checklists')
            .select('*, checklist_items(*, chore_templates(*))')
            .eq('id', existing.id)
            .single()
          if (refilled) {
            setChecklists(prev => ({ ...prev, [childId]: refilled as ChecklistWithItems }))
            return refilled as ChecklistWithItems
          }
        }
      }
      setChecklists(prev => ({ ...prev, [childId]: existing as ChecklistWithItems }))
      return existing as ChecklistWithItems
    }

    const { data: newCl } = await supabase
      .from('weekly_checklists')
      .insert({ child_id: childId, week_start: weekStart, base_amount: 0, extra_amount: 0 })
      .select()
      .single()

    const activeChores = chores.filter(c => c.active)
    if (activeChores.length > 0) {
      await supabase.from('checklist_items').insert(
        activeChores.map(c => ({
          checklist_id: newCl.id,
          chore_id: c.id,
          checked: false,
          reward_earned: 0,
        }))
      )
    }

    const { data: full } = await supabase
      .from('weekly_checklists')
      .select('*, checklist_items(*, chore_templates(*))')
      .eq('id', newCl.id)
      .single()

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
    const requiredAll = updatedItems.filter(i => i.chore_templates?.type === 'required').every(i => i.checked)
    const baseAmount = requiredAll ? defaultAllowance : 0
    const extraAmount = updatedItems.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    await supabase.from('weekly_checklists').update({ base_amount: baseAmount, extra_amount: extraAmount }).eq('id', cl.id)
    setChecklists(prev => ({
      ...prev,
      [childId]: { ...cl, base_amount: baseAmount, extra_amount: extraAmount, checklist_items: updatedItems } as ChecklistWithItems
    }))
  }

  async function setExtraCount(childId: string, itemId: string, chore: ChoreTemplate, count: number) {
    const cl = await ensureChecklist(childId)
    const reward = count * (chore.reward_amount ?? 0)
    await supabase.from('checklist_items').update({ count, checked: count > 0, reward_earned: reward }).eq('id', itemId)
    const updatedItems = cl.checklist_items.map(i =>
      i.id === itemId ? { ...i, count, checked: count > 0, reward_earned: reward } : i
    )
    const requiredAll = updatedItems.filter(i => i.chore_templates?.type === 'required').every(i => i.checked)
    const baseAmount = requiredAll ? defaultAllowance : 0
    const extraAmount = updatedItems.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    await supabase.from('weekly_checklists').update({ base_amount: baseAmount, extra_amount: extraAmount }).eq('id', cl.id)
    setChecklists(prev => ({
      ...prev,
      [childId]: { ...cl, base_amount: baseAmount, extra_amount: extraAmount, checklist_items: updatedItems } as ChecklistWithItems
    }))
  }

  async function approveAllowance(child: Profile) {
    setSaving(child.id)
    setMsg('')
    const cl = await ensureChecklist(child.id)
    const total = cl.base_amount + cl.extra_amount

    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('weekly_checklists').update({
      status: 'approved',
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', cl.id)

    // Money is NOT deposited yet — child must log in, set tithe, then net amount deposits
    if (total > 0) {
      const { data: settings } = await supabase.from('app_settings').select('value').eq('key', 'tithe_percentage').single()
      const pct = parseFloat(settings?.value ?? '10')

      // Add any interest earned since the last completed tithe
      const { data: lastTithe } = await supabase
        .from('tithe_records')
        .select('created_at')
        .eq('child_id', child.id)
        .eq('completed', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const since = lastTithe?.created_at ?? '1970-01-01'
      const { data: interestTx } = await supabase
        .from('transactions')
        .select('amount')
        .eq('child_id', child.id)
        .eq('type', 'interest')
        .gte('created_at', since)

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
    setSaving(null)
  }

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>

  const required = chores.filter(c => c.type === 'required')
  const extras = chores.filter(c => c.type === 'extra')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Weekly Checklists</h1>
        <p style={{ color: '#64748b', marginTop: '0.25rem', fontSize: '0.9rem' }}>
          Week of {new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          {' · '}Default allowance: {formatMoney(defaultAllowance)}
        </p>
      </div>

      {msg && (
        <div style={{ background: '#dcfce7', color: '#15803d', padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.875rem' }}>
          {msg}
        </div>
      )}

      {children.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
          No children accounts yet.
        </div>
      )}

      {children.map(child => {
        const cl = checklists[child.id]
        const items = cl?.checklist_items ?? []
        const total = (cl?.base_amount ?? 0) + (cl?.extra_amount ?? 0)
        const approved = cl?.status === 'approved'

        const reqItems = items.filter(i => i.chore_templates?.type === 'required')
        const extraItems = items.filter(i => i.chore_templates?.type === 'extra')
        const reqAllChecked = required.length > 0 && reqItems.length > 0 && reqItems.every(i => i.checked)

        return (
          <div key={child.id} className="card">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{
                width: '48px', height: '48px',
                background: '#dcfce7', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.25rem', fontWeight: 700, color: '#16a34a', flexShrink: 0,
              }}>
                {child.name.charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{child.name}</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Balance: {formatMoney(child.balance)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>This week&apos;s allowance</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#16a34a' }}>{formatMoney(total)}</div>
              </div>
            </div>

            {approved ? (
              <div style={{
                background: '#f0fdf4', border: '1px solid #bbf7d0',
                borderRadius: '0.75rem', padding: '1rem',
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                color: '#15803d', fontWeight: 600,
              }}>
                <span style={{ fontSize: '1.25rem' }}>✅</span>
                Allowance approved — {formatMoney(total)} added to account
              </div>
            ) : (
              <>
                {/* Part 1: Required chores */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    marginBottom: '0.75rem',
                  }}>
                    <span style={{
                      background: '#dbeafe', color: '#1d4ed8',
                      fontSize: '0.75rem', fontWeight: 700,
                      padding: '0.2rem 0.6rem', borderRadius: '999px',
                    }}>PART 1 — Required</span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      All checked = {formatMoney(defaultAllowance)} base allowance
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {required.map(chore => {
                      const item = reqItems.find(i => i.chore_id === chore.id)
                      if (!item) return null
                      return (
                        <label key={chore.id} style={{
                          display: 'flex', alignItems: 'center', gap: '0.75rem',
                          padding: '0.75rem 1rem',
                          background: item.checked ? '#f0fdf4' : '#f8fafc',
                          borderRadius: '0.75rem',
                          cursor: 'pointer',
                          border: `1px solid ${item.checked ? '#bbf7d0' : '#e2e8f0'}`,
                          transition: 'all 0.15s',
                        }}>
                          <input
                            type="checkbox"
                            checked={item.checked}
                            onChange={e => toggleItem(child.id, item.id, chore, e.target.checked)}
                            style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#16a34a' }}
                          />
                          <span style={{ fontWeight: 500, flex: 1 }}>{chore.name}</span>
                          {item.checked && <span style={{ color: '#16a34a', fontSize: '0.85rem', fontWeight: 600 }}>✓</span>}
                        </label>
                      )
                    })}
                    {required.length === 0 && (
                      <p style={{ color: '#94a3b8', fontSize: '0.875rem', padding: '0.5rem' }}>No required chores set. Add them in Settings.</p>
                    )}
                  </div>
                  {reqAllChecked && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#15803d', fontWeight: 600 }}>
                      ✅ All required chores done! Base allowance: {formatMoney(defaultAllowance)}
                    </div>
                  )}
                </div>

                {/* Part 2: Extra tasks */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span style={{
                      background: '#fef3c7', color: '#d97706',
                      fontSize: '0.75rem', fontWeight: 700,
                      padding: '0.2rem 0.6rem', borderRadius: '999px',
                    }}>PART 2 — Extra Rewards</span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Optional bonus tasks</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {extras.map(chore => {
                      const item = extraItems.find(i => i.chore_id === chore.id)
                      if (!item) return null
                      const count = item.count ?? 0
                      const earned = count * (chore.reward_amount ?? 0)
                      return (
                        <div key={chore.id} style={{
                          display: 'flex', alignItems: 'center', gap: '0.75rem',
                          padding: '0.75rem 1rem',
                          background: count > 0 ? '#fffbeb' : '#f8fafc',
                          borderRadius: '0.75rem',
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
                              padding: '0.25rem 0.5rem', fontSize: '0.9rem',
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
                            minWidth: '3.5rem', textAlign: 'right',
                          }}>
                            +{formatMoney(earned)}
                          </span>
                        </div>
                      )
                    })}
                    {extras.length === 0 && (
                      <p style={{ color: '#94a3b8', fontSize: '0.875rem', padding: '0.5rem' }}>No extra tasks set. Add them in Settings.</p>
                    )}
                  </div>
                </div>

                {/* Summary + approve */}
                <div style={{
                  background: '#f8fafc', borderRadius: '0.75rem',
                  padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem',
                  flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Base</div>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{formatMoney(cl?.base_amount ?? 0)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Extras</div>
                      <div style={{ fontWeight: 700, color: '#d97706' }}>{formatMoney(cl?.extra_amount ?? 0)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Total</div>
                      <div style={{ fontWeight: 700, color: '#16a34a', fontSize: '1.1rem' }}>{formatMoney(total)}</div>
                    </div>
                  </div>
                  <button
                    className="btn-primary"
                    onClick={() => approveAllowance(child)}
                    disabled={saving === child.id || total === 0}
                  >
                    {saving === child.id ? 'Approving...' : `Approve & Pay ${formatMoney(total)}`}
                  </button>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
