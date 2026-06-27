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
  // Use local date parts — toISOString() returns UTC which is one day behind SGT before 8am
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function getNextSaturday() {
  const d = new Date()
  const day = d.getDay()
  const daysToThisSat = day === 6 ? 0 : (6 - day)
  d.setDate(d.getDate() + daysToThisSat + 7)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function getTodayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

type ChecklistWithItems = WeeklyChecklist & { checklist_items: (ChecklistItem & { chore_templates: ChoreTemplate })[] }
interface LogEntry { id: string; logged_at: string }

export default function ChecklistPage() {
  const supabase = createClient()
  const [children, setChildren] = useState<Profile[]>([])
  const [chores, setChores] = useState<ChoreTemplate[]>([])
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [checklists, setChecklists] = useState<Record<string, ChecklistWithItems>>({})
  const [nextChecklists, setNextChecklists] = useState<Record<string, ChecklistWithItems>>({})
  const [taskLogs, setTaskLogs] = useState<Record<string, LogEntry[]>>({})
  const [nextTaskLogs, setNextTaskLogs] = useState<Record<string, LogEntry[]>>({})
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({})
  const [defaultAllowance, setDefaultAllowance] = useState(100)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const weekStart = getThisSaturday()
  const nextWeekStart = getNextSaturday()
  const todayStr = getTodayStr()

  function buildLogMap(logs: Array<{ id: string; child_id: string; chore_id: string; logged_at: string }>) {
    const logMap: Record<string, LogEntry[]> = {}
    for (const log of logs ?? []) {
      const key = `${log.child_id}-${log.chore_id}`
      if (!logMap[key]) logMap[key] = []
      logMap[key].push({ id: log.id, logged_at: log.logged_at })
    }
    return logMap
  }

  const load = useCallback(async () => {
    const [
      { data: ch }, { data: cr }, { data: cl }, { data: nextCl },
      { data: settings }, { data: logs }, { data: nextLogs }, { data: asgn },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'child').order('name'),
      supabase.from('chore_templates').select('*').eq('active', true).order('sort_order'),
      supabase.from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('week_start', weekStart),
      supabase.from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('week_start', nextWeekStart),
      supabase.from('app_settings').select('*').eq('key', 'default_allowance').single(),
      supabase.from('extra_task_logs').select('id, child_id, chore_id, logged_at').eq('week_start', weekStart).order('logged_at', { ascending: false }),
      supabase.from('extra_task_logs').select('id, child_id, chore_id, logged_at').eq('week_start', nextWeekStart).order('logged_at', { ascending: false }),
      supabase.from('chore_assignments').select('child_id, chore_id'),
    ])

    setChildren(ch ?? [])
    setChores(cr ?? [])
    if (settings) setDefaultAllowance(parseFloat(settings.value))

    const asgnMap: Record<string, string[]> = {}
    for (const a of asgn ?? []) {
      if (!asgnMap[a.child_id]) asgnMap[a.child_id] = []
      asgnMap[a.child_id].push(a.chore_id)
    }
    setAssignments(asgnMap)

    const logMap = buildLogMap(logs ?? [])
    const nextLogMap = buildLogMap(nextLogs ?? [])
    setTaskLogs(logMap)
    setNextTaskLogs(nextLogMap)

    // Sync extra task counts from logs for pending checklists
    const syncBatch: PromiseLike<unknown>[] = []
    const bothWeeks: [ChecklistWithItems[], Record<string, LogEntry[]>][] = [
      [(cl ?? []) as ChecklistWithItems[], logMap],
      [(nextCl ?? []) as ChecklistWithItems[], nextLogMap],
    ]
    for (const [clList, lm] of bothWeeks) {
      for (const checklist of clList) {
        if (checklist.status === 'approved') continue
        let extraDirty = false
        for (const item of checklist.checklist_items) {
          if (item.chore_templates?.type !== 'extra') continue
          if (item.admin_adjusted) continue
          const logCount = lm[`${checklist.child_id}-${item.chore_id}`]?.length ?? 0
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
    }
    if (syncBatch.length > 0) await Promise.all(syncBatch)

    const clMap: Record<string, ChecklistWithItems> = {}
    for (const c of (cl ?? []) as ChecklistWithItems[]) clMap[c.child_id] = c
    setChecklists(clMap)

    const nextClMap: Record<string, ChecklistWithItems> = {}
    for (const c of (nextCl ?? []) as ChecklistWithItems[]) nextClMap[c.child_id] = c
    setNextChecklists(nextClMap)

    setLoading(false)
    setRefreshing(false)
  }, [supabase, weekStart, nextWeekStart])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (loading || children.length === 0 || chores.length === 0) return
    children.forEach(child => {
      const thisWeekCl = checklists[child.id]
      const thisApproved = thisWeekCl?.status === 'approved'
      if (thisApproved) {
        const nextCl = nextChecklists[child.id]
        if (!nextCl || nextCl.checklist_items.length === 0) ensureChecklist(child.id, nextWeekStart)
      } else {
        if (!thisWeekCl || thisWeekCl.checklist_items.length === 0) ensureChecklist(child.id, weekStart)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, children, chores, checklists])

  function getChildChores(childId: string): ChoreTemplate[] {
    const assigned = assignments[childId]
    if (assigned && assigned.length > 0) return chores.filter(c => assigned.includes(c.id))
    return chores
  }

  async function syncNewItems(
    childId: string,
    items: (ChecklistItem & { chore_templates: ChoreTemplate })[],
    checklistId: string,
    currentExtra: number,
    logMap: Record<string, LogEntry[]>,
  ): Promise<number> {
    const syncBatch: PromiseLike<unknown>[] = []
    let dirty = false
    for (const item of items) {
      if (item.chore_templates?.type !== 'extra') continue
      const logCount = logMap[`${childId}-${item.chore_id}`]?.length ?? 0
      if (logCount > 0 && item.count !== logCount) {
        const reward = logCount * (item.chore_templates.reward_amount ?? 0)
        item.count = logCount
        item.checked = logCount > 0
        item.reward_earned = reward
        dirty = true
        syncBatch.push(
          supabase.from('checklist_items').update({ count: logCount, checked: logCount > 0, reward_earned: reward }).eq('id', item.id).then(() => {})
        )
      }
    }
    if (!dirty) return currentExtra
    const newExtra = items.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    syncBatch.push(
      supabase.from('weekly_checklists').update({ extra_amount: newExtra }).eq('id', checklistId).then(() => {})
    )
    await Promise.all(syncBatch)
    return newExtra
  }

  async function ensureChecklist(childId: string, targetWeekStart: string): Promise<ChecklistWithItems> {
    const isNext = targetWeekStart === nextWeekStart
    const clMap = isNext ? nextChecklists : checklists
    const setClMap = isNext ? setNextChecklists : setChecklists
    const logMap = isNext ? nextTaskLogs : taskLogs

    if (clMap[childId]?.checklist_items.length > 0) return clMap[childId]
    const choresToUse = getChildChores(childId)

    const { data: existing } = await supabase
      .from('weekly_checklists')
      .select('*, checklist_items(*, chore_templates(*))')
      .eq('child_id', childId)
      .eq('week_start', targetWeekStart)
      .single()

    if (existing) {
      if ((existing.checklist_items?.length ?? 0) === 0 && choresToUse.length > 0) {
        await supabase.from('checklist_items').insert(
          choresToUse.map(c => ({ checklist_id: existing.id, chore_id: c.id, checked: false, reward_earned: 0 }))
        )
        const { data: refilled } = await supabase
          .from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('id', existing.id).single()
        if (refilled) {
          const r = refilled as ChecklistWithItems
          r.extra_amount = await syncNewItems(childId, r.checklist_items, r.id, r.extra_amount, logMap)
          setClMap(prev => ({ ...prev, [childId]: r }))
          return r
        }
      }
      setClMap(prev => ({ ...prev, [childId]: existing as ChecklistWithItems }))
      return existing as ChecklistWithItems
    }

    const { data: newCl } = await supabase
      .from('weekly_checklists')
      .insert({ child_id: childId, week_start: targetWeekStart, base_amount: 0, extra_amount: 0 })
      .select().single()

    if (!newCl) {
      const { data: fallback } = await supabase
        .from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('child_id', childId).eq('week_start', targetWeekStart).single()
      if (fallback) {
        setClMap(prev => ({ ...prev, [childId]: fallback as ChecklistWithItems }))
        return fallback as ChecklistWithItems
      }
      return clMap[childId]
    }

    if (choresToUse.length > 0) {
      await supabase.from('checklist_items').insert(
        choresToUse.map(c => ({ checklist_id: newCl.id, chore_id: c.id, checked: false, reward_earned: 0 }))
      )
    }

    const { data: full } = await supabase
      .from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('id', newCl.id).single()

    const result = full as ChecklistWithItems
    result.extra_amount = await syncNewItems(childId, result.checklist_items, result.id, result.extra_amount, logMap)
    setClMap(prev => ({ ...prev, [childId]: result }))
    return result
  }

  async function toggleItem(childId: string, itemId: string, chore: ChoreTemplate, checked: boolean) {
    const thisApproved = checklists[childId]?.status === 'approved'
    const targetWeekStart = thisApproved ? nextWeekStart : weekStart
    const setClMap = thisApproved ? setNextChecklists : setChecklists
    const cl = await ensureChecklist(childId, targetWeekStart)
    await supabase.from('checklist_items').update({ checked, reward_earned: 0, count: 0 }).eq('id', itemId)
    const updatedItems = cl.checklist_items.map(i =>
      i.id === itemId ? { ...i, checked, reward_earned: 0, count: 0 } : i
    )
    const reqItems = updatedItems.filter(i => i.chore_templates?.type === 'required')
    const requiredAll = reqItems.length > 0 && reqItems.every(i => i.checked)
    const baseAmount = requiredAll ? defaultAllowance : 0
    const extraAmount = updatedItems.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    await supabase.from('weekly_checklists').update({ base_amount: baseAmount, extra_amount: extraAmount }).eq('id', cl.id)
    setClMap(prev => ({
      ...prev,
      [childId]: { ...cl, base_amount: baseAmount, extra_amount: extraAmount, checklist_items: updatedItems } as ChecklistWithItems,
    }))
  }

  async function setExtraCount(childId: string, itemId: string, chore: ChoreTemplate, count: number) {
    if (count < 0) return
    const thisApproved = checklists[childId]?.status === 'approved'
    const targetWeekStart = thisApproved ? nextWeekStart : weekStart
    const setClMap = thisApproved ? setNextChecklists : setChecklists
    const cl = await ensureChecklist(childId, targetWeekStart)
    const reward = count * (chore.reward_amount ?? 0)
    await supabase.from('checklist_items').update({ count, checked: count > 0, reward_earned: reward, admin_adjusted: true }).eq('id', itemId)
    const updatedItems = cl.checklist_items.map(i =>
      i.id === itemId ? { ...i, count, checked: count > 0, reward_earned: reward } : i
    )
    const reqItems = updatedItems.filter(i => i.chore_templates?.type === 'required')
    const requiredAll = reqItems.length > 0 && reqItems.every(i => i.checked)
    const baseAmount = requiredAll ? defaultAllowance : 0
    const extraAmount = updatedItems.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    await supabase.from('weekly_checklists').update({ base_amount: baseAmount, extra_amount: extraAmount }).eq('id', cl.id)
    setClMap(prev => ({
      ...prev,
      [childId]: { ...cl, base_amount: baseAmount, extra_amount: extraAmount, checklist_items: updatedItems } as ChecklistWithItems,
    }))
  }

  async function approveAllowance(child: Profile) {
    setSaving(child.id)
    setMsg('')
    const thisApproved = checklists[child.id]?.status === 'approved'
    const targetWeekStart = thisApproved ? nextWeekStart : weekStart
    const cl = await ensureChecklist(child.id, targetWeekStart)
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Weekly Checklists</h1>
          <p style={{ color: '#64748b', marginTop: '0.25rem', fontSize: '0.9rem' }}>
            Week of {new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            {' · '}Default allowance: {formatMoney(defaultAllowance)}
          </p>
        </div>
        <button
          onClick={() => { setRefreshing(true); load() }}
          disabled={refreshing}
          style={{
            background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.625rem',
            padding: '0.5rem 1rem', fontSize: '0.825rem', fontWeight: 600, color: '#64748b',
            cursor: refreshing ? 'not-allowed' : 'pointer', opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh counts'}
        </button>
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
        const thisWeekCl = checklists[child.id]
        const thisApproved = thisWeekCl?.status === 'approved'
        // After this week is approved, switch to showing next week's checklist
        const cl = thisApproved ? nextChecklists[child.id] : thisWeekCl
        const activeLogs = thisApproved ? nextTaskLogs : taskLogs
        const activeWeekStart = thisApproved ? nextWeekStart : weekStart
        const isActiveWeekToday = activeWeekStart === todayStr

        const items = cl?.checklist_items ?? []
        const total = (cl?.base_amount ?? 0) + (cl?.extra_amount ?? 0)

        const reqItems = items.filter(i => i.chore_templates?.type === 'required')
        const extraItems = items.filter(i => i.chore_templates?.type === 'extra')
        const reqAllChecked = required.length > 0 && reqItems.length > 0 && reqItems.every(i => i.checked)

        const assignedIds = assignments[child.id]
        const extrasForChild = chores.filter(c =>
          c.type === 'extra' && (assignedIds && assignedIds.length > 0 ? assignedIds.includes(c.id) : true)
        )

        return (
          <div key={child.id} className="card">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
              <div style={{
                width: '48px', height: '48px', background: '#dcfce7', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.25rem', fontWeight: 700, color: '#16a34a', flexShrink: 0,
              }}>
                {child.name.charAt(0)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>{child.name}</span>
                  {thisApproved && (
                    <span style={{ fontSize: '0.7rem', background: '#dcfce7', color: '#15803d', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
                      ✅ This week approved
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Balance: {formatMoney(child.balance)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  {thisApproved ? `Next week · ${new Date(nextWeekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : "This week's allowance"}
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#16a34a' }}>{formatMoney(total)}</div>
              </div>
            </div>

            {/* Part 1: Required chores */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                  PART 1 — Required
                </span>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>All checked = {formatMoney(defaultAllowance)} base allowance</span>
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
                        onChange={e => isActiveWeekToday && toggleItem(child.id, item.id, chore, e.target.checked)}
                        disabled={!isActiveWeekToday}
                        style={{ width: '18px', height: '18px', cursor: isActiveWeekToday ? 'pointer' : 'not-allowed', accentColor: '#16a34a' }}
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
                  All required chores done! Base allowance: {formatMoney(defaultAllowance)}
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
                {extrasForChild.map(chore => {
                  const item = extraItems.find(i => i.chore_id === chore.id)
                  if (!item) return null
                  const count = item.count ?? 0
                  const earned = count * (chore.reward_amount ?? 0)
                  const logKey = `${child.id}-${chore.id}`
                  const logs = activeLogs[logKey] ?? []
                  const isExpanded = expandedLogs[logKey] ?? false

                  return (
                    <div key={chore.id} style={{ border: `1px solid ${count > 0 ? '#fde68a' : '#e2e8f0'}`, borderRadius: '0.75rem', overflow: 'hidden' }}>
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.75rem 1rem',
                        background: count > 0 ? '#fffbeb' : '#f8fafc',
                      }}>
                        <span style={{ fontWeight: 500, flex: 1, fontSize: '0.925rem' }}>{chore.name}</span>
                        <span style={{ fontSize: '0.78rem', color: '#94a3b8', flexShrink: 0 }}>{formatMoney(chore.reward_amount ?? 0)}/session</span>

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
                {extrasForChild.length === 0 && (
                  <p style={{ color: '#94a3b8', fontSize: '0.875rem', padding: '0.5rem' }}>No extra tasks assigned to {child.name}. Assign them in Settings.</p>
                )}
              </div>
            </div>

            {/* Summary + approve */}
            <div style={{
              background: '#f8fafc', borderRadius: '0.75rem',
              padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
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
                disabled={saving === child.id || total === 0 || !isActiveWeekToday}
              >
                {saving === child.id
                  ? 'Approving...'
                  : !isActiveWeekToday
                    ? `Available ${new Date(activeWeekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                    : `Approve & Pay ${formatMoney(total)}`}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
