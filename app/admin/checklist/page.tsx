'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Profile, ChoreTemplate, WeeklyChecklist, ChecklistItem } from '@/lib/types'

function formatMoney(n: number) {
  return '$' + Math.ceil(n).toLocaleString()
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function getThisSaturday() {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 6 ? 0 : (6 - day)
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

type ChecklistWithItems = WeeklyChecklist & { checklist_items: (ChecklistItem & { chore_templates: ChoreTemplate })[] }
interface LogEntry { id: string; logged_at: string }

export default function ChecklistPage() {
  const supabase = createClient()
  const [children, setChildren] = useState<Profile[]>([])
  const [chores, setChores] = useState<ChoreTemplate[]>([])
  const [checklists, setChecklists] = useState<Record<string, ChecklistWithItems>>({})
  // taskLogs keyed by `${childId}-${choreId}`
  const [taskLogs, setTaskLogs] = useState<Record<string, LogEntry[]>>({})
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({})
  const [defaultAllowance, setDefaultAllowance] = useState(100)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const weekStart = getThisSaturday()

  const load = useCallback(async () => {
    const [{ data: ch }, { data: cr }, { data: cl }, { data: settings }, { data: logs }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'child').order('name'),
      supabase.from('chore_templates').select('*').eq('active', true).order('sort_order'),
      supabase.from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('week_start', weekStart),
      supabase.from('app_settings').select('*').eq('key', 'default_allowance').single(),
      supabase.from('extra_task_logs').select('id, child_id, chore_id, logged_at').eq('week_start', weekStart).order('logged_at', { ascending: false }),
    ])

    setChildren(ch ?? [])
    setChores(cr ?? [])
    if (settings) setDefaultAllowance(parseFloat(settings.value))

    // Build log map keyed by `${childId}-${choreId}`
    const logMap: Record<string, LogEntry[]> = {}
    for (const log of logs ?? []) {
      const key = `${log.child_id}-${log.chore_id}`
      if (!logMap[key]) logMap[key] = []
      logMap[key].push({ id: log.id, logged_at: log.logged_at })
    }
    setTaskLogs(logMap)

    // Build checklist map, then auto-sync extra counts from logs
    const clList = (cl ?? []) as ChecklistWithItems[]
    const syncBatch: PromiseLike<unknown>[] = []

    for (const checklist of clList) {
      if (checklist.status === 'approved') continue
      let extraDirty = false
      for (const item of checklist.checklist_items) {
        if (item.chore_templates?.type !== 'extra') continue
        const logCount = logMap[`${checklist.child_id}-${item.chore_id}`]?.length ?? 0
        if (item.count !== logCount) {
          const reward = logCount * (item.chore_templates.reward_amount ?? 0)
          item.count = logCount
          item.checked = logCount > 0
          item.reward_earned = reward
          extraDirty = true
          syncBatch.push(
            supabase.from('checklist_items').update({ count: logCount, checked: logCount > 0, reward_earned: reward }).eq('id', item.id).then(() => {})
          )
        }
      }
      if (extraDirty) {
        const newExtra = checklist.checklist_items
          .filter(i => i.chore_templates?.type === 'extra')
          .reduce((s, i) => s + i.reward_earned, 0)
        checklist.extra_amount = newExtra
        syncBatch.push(
          supabase.from('weekly_checklists').update({ extra_amount: newExtra }).eq('id', checklist.id).then(() => {})
        )
      }
    }

    if (syncBatch.length > 0) await Promise.all(syncBatch)

    const clMap: Record<string, ChecklistWithItems> = {}
    for (const c of clList) clMap[c.child_id] = c
    setChecklists(clMap)
    setLoading(false)
  }, [supabase, weekStart])

  useEffect(() => { load() }, [load])

  // Auto-create checklists (and items) for all children when page loads
  useEffect(() => {
    if (loading || children.length === 0 || chores.length === 0) return
    children.forEach(child => {
      const cl = checklists[child.id]
      if (!cl || cl.checklist_items.length === 0) ensureChecklist(child.id)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, children, chores])

  async function ensureChecklist(childId: string): Promise<ChecklistWithItems> {
    if (checklists[childId]?.checklist_items.length > 0) return checklists[childId]

    const { data: existing } = await supabase
      .from('weekly_checklists')
      .select('*, checklist_items(*, chore_templates(*))')
      .eq('child_id', childId)
      .eq('week_start', weekStart)
      .single()

    if (existing) {
      if ((existing.checklist_items?.length ?? 0) === 0) {
        const activeChores = chores.filter(c => c.active)
        if (activeChores.length > 0) {
          await supabase.from('checklist_items').insert(
            activeChores.map(c => ({ checklist_id: existing.id, chore_id: c.id, checked: false, reward_earned: 0 }))
          )
          const { data: refilled } = await supabase
            .from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('id', existing.id).single()
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
      .select().single()

    const activeChores = chores.filter(c => c.active)
    if (activeChores.length > 0) {
      await supabase.from('checklist_items').insert(
        activeChores.map(c => ({ checklist_id: newCl.id, chore_id: c.id, checked: false, reward_earned: 0 }))
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
    if (count < 0) return
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

      await supabase.from('tithe_records').insert({
        child_id: child.id,
        checklist_id: cl.id,
        income_amount: total,
        tithe_amount: Math.ceil(total * pct / 100),
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <span style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                      PART 1 — Required
                    </span>
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
                          borderRadius: '0.75rem', cursor: 'pointer',
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
                    <span style={{ background: '#fef3c7', color: '#d97706', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                      PART 2 — Extra Rewards
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>From child records — adjust if needed</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {extras.map(chore => {
                      const item = extraItems.find(i => i.chore_id === chore.id)
                      if (!item) return null
                      const count = item.count ?? 0
                      const earned = count * (chore.reward_amount ?? 0)
                      const logKey = `${child.id}-${chore.id}`
                      const logs = taskLogs[logKey] ?? []
                      const isExpanded = expandedLogs[logKey] ?? false

                      return (
                        <div key={chore.id} style={{ border: `1px solid ${count > 0 ? '#fde68a' : '#e2e8f0'}`, borderRadius: '0.75rem', overflow: 'hidden' }}>
                          {/* Main row */}
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.75rem 1rem',
                            background: count > 0 ? '#fffbeb' : '#f8fafc',
                          }}>
                            <span style={{ fontWeight: 500, flex: 1, fontSize: '0.925rem' }}>{chore.name}</span>
                            <span style={{ fontSize: '0.78rem', color: '#94a3b8', flexShrink: 0 }}>{formatMoney(chore.reward_amount ?? 0)}/session</span>

                            {/* Log count badge — click to view records */}
                            <button
                              onClick={() => setExpandedLogs(prev => ({ ...prev, [logKey]: !isExpanded }))}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.3rem',
                                background: logs.length > 0 ? '#e0f2fe' : '#f1f5f9',
                                color: logs.length > 0 ? '#0369a1' : '#94a3b8',
                                border: 'none', borderRadius: '999px',
                                padding: '0.25rem 0.625rem',
                                fontSize: '0.75rem', fontWeight: 600,
                                cursor: 'pointer', flexShrink: 0,
                              }}
                              title="View child's session records"
                            >
                              📱 {logs.length} <span style={{ fontSize: '0.6rem' }}>{isExpanded ? '▲' : '▼'}</span>
                            </button>

                            {/* +/- count controls */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                              <button
                                onClick={() => setExtraCount(child.id, item.id, chore, count - 1)}
                                disabled={count === 0}
                                style={{
                                  width: '28px', height: '28px', borderRadius: '50%',
                                  border: '1.5px solid #e2e8f0', background: 'white',
                                  fontSize: '1rem', fontWeight: 700, cursor: count === 0 ? 'not-allowed' : 'pointer',
                                  opacity: count === 0 ? 0.35 : 1, color: '#374151',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                              >−</button>
                              <span style={{
                                minWidth: '1.75rem', textAlign: 'center',
                                fontWeight: 700, fontSize: '1rem',
                                color: count > 0 ? '#d97706' : '#94a3b8',
                              }}>{count}</span>
                              <button
                                onClick={() => setExtraCount(child.id, item.id, chore, count + 1)}
                                style={{
                                  width: '28px', height: '28px', borderRadius: '50%',
                                  border: '1.5px solid #e2e8f0', background: 'white',
                                  fontSize: '1rem', fontWeight: 700, cursor: 'pointer', color: '#374151',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                              >+</button>
                            </div>

                            {/* Earned amount */}
                            <span style={{
                              background: count > 0 ? '#fef3c7' : '#f1f5f9',
                              color: count > 0 ? '#d97706' : '#94a3b8',
                              fontSize: '0.85rem', fontWeight: 700,
                              padding: '0.2rem 0.6rem', borderRadius: '999px',
                              minWidth: '3.5rem', textAlign: 'right', flexShrink: 0,
                            }}>
                              +{formatMoney(earned)}
                            </span>
                          </div>

                          {/* Expandable session log */}
                          {isExpanded && (
                            <div style={{ borderTop: '1px solid #e2e8f0', background: 'white' }}>
                              {logs.length === 0 ? (
                                <div style={{ padding: '0.625rem 1rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                                  No sessions recorded by child this week.
                                </div>
                              ) : (
                                logs.map((log, i) => (
                                  <div key={log.id} style={{
                                    padding: '0.4rem 1rem',
                                    borderBottom: i < logs.length - 1 ? '1px solid #f8fafc' : 'none',
                                    fontSize: '0.78rem', color: '#64748b',
                                  }}>
                                    Session {logs.length - i} · {formatDateTime(log.logged_at)}
                                  </div>
                                ))
                              )}
                            </div>
                          )}
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
