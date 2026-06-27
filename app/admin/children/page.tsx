'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Profile, ChoreTemplate, WeeklyChecklist, ChecklistItem, WithdrawalRequest, Transaction } from '@/lib/types'

function formatMoney(n: number) {
  return '$' + Math.ceil(n).toLocaleString()
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

interface LogEntry { id: string; logged_at: string }

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
type WRWithProfile = WithdrawalRequest & { profiles: { name: string; balance: number } }
type SectionKey = 'checklist' | 'withdrawals' | 'adjust' | 'history' | 'weeks'
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
  const nextWeekStart = getNextSaturday()
  const todayStr = getTodayStr()
  const isSaturday = new Date().getDay() === 6

  const [children, setChildren] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  const [activeSection, setActiveSection] = useState<Record<string, SectionKey | null>>({})


  const [chores, setChores] = useState<ChoreTemplate[]>([])
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [checklists, setChecklists] = useState<Record<string, ChecklistWithItems>>({})
  const [nextChecklists, setNextChecklists] = useState<Record<string, ChecklistWithItems>>({})
  const [completedTithes, setCompletedTithes] = useState<Set<string>>(new Set())
  const [defaultAllowance, setDefaultAllowance] = useState(100)
  const [defaultTithePct, setDefaultTithePct] = useState(10)
  const [checklistSaving, setChecklistSaving] = useState<string | null>(null)
  const [missedChecklists, setMissedChecklists] = useState<Record<string, ChecklistWithItems[]>>({})
  const [missedSaving, setMissedSaving] = useState<string | null>(null)

  const [withdrawals, setWithdrawals] = useState<WRWithProfile[]>([])
  const [actingWR, setActingWR] = useState<string | null>(null)

  const [adjustForms, setAdjustForms] = useState<Record<string, AdjustForm>>({})
  const [adjustSaving, setAdjustSaving] = useState<string | null>(null)
  const [manualTithes, setManualTithes] = useState<Record<string, ManualTitheRecord[]>>({})

  const [childHistory, setChildHistory] = useState<Record<string, Transaction[]>>({})
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(new Set())
  const [historyFilters, setHistoryFilters] = useState<Record<string, { type: string; span: number }>>({})

  const [weekHistory, setWeekHistory] = useState<Record<string, ChecklistWithItems[]>>({})
  const [weekHistoryLoading, setWeekHistoryLoading] = useState<Set<string>>(new Set())
  const [adminNames, setAdminNames] = useState<Record<string, string>>({})
  const [expandedWeeks, setExpandedWeeks] = useState<Record<string, boolean>>({})


  // Extra task logs: keyed by `${childId}-${choreId}`
  const [taskLogs, setTaskLogs] = useState<Record<string, LogEntry[]>>({})
  const [nextTaskLogs, setNextTaskLogs] = useState<Record<string, LogEntry[]>>({})
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    const [{ data: ch }, { data: cr }, { data: cl }, { data: nextCl }, { data: settings }, { data: titheSetting }, { data: wr }, { data: asgn }, { data: titheDone }, { data: manualTitheData }, { data: logs }, { data: nextLogs }, { data: olderCl }] = await Promise.all([
      supabase.from('profiles').select('*').eq('role', 'child').order('name'),
      supabase.from('chore_templates').select('*').eq('active', true).order('type').order('sort_order'),
      supabase.from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('week_start', weekStart),
      supabase.from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('week_start', nextWeekStart),
      supabase.from('app_settings').select('*').eq('key', 'default_allowance').single(),
      supabase.from('app_settings').select('value').eq('key', 'tithe_percentage').single(),
      supabase.from('withdrawal_requests').select('*, profiles(name, balance)').eq('status', 'pending').order('created_at', { ascending: true }),
      supabase.from('chore_assignments').select('child_id, chore_id'),
      supabase.from('tithe_records').select('checklist_id').eq('completed', true),
      supabase.from('tithe_records').select('id, child_id, income_amount, completed, description, created_at').is('checklist_id', null).order('created_at', { ascending: false }),
      supabase.from('extra_task_logs').select('id, child_id, chore_id, logged_at').eq('week_start', weekStart).order('logged_at', { ascending: false }),
      supabase.from('extra_task_logs').select('id, child_id, chore_id, logged_at').eq('week_start', nextWeekStart).order('logged_at', { ascending: false }),
      supabase.from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').lt('week_start', weekStart).eq('status', 'pending').order('week_start', { ascending: true }),
    ])

    setChildren(ch ?? [])
    setChores(cr ?? [])
    if (settings) setDefaultAllowance(parseFloat(settings.value))
    if (titheSetting) setDefaultTithePct(parseFloat(titheSetting.value))
    setWithdrawals((wr as WRWithProfile[]) ?? [])

    // Build assignment map first — needed for missing-item detection
    const asgnMap: Record<string, string[]> = {}
    for (const a of asgn ?? []) {
      if (!asgnMap[a.child_id]) asgnMap[a.child_id] = []
      asgnMap[a.child_id].push(a.chore_id)
    }
    setAssignments(asgnMap)

    const choreMap = Object.fromEntries((cr ?? []).map(c => [c.id, c]))
    const clList = (cl ?? []) as ChecklistWithItems[]

    // Create checklist_items for any assigned chores that are missing from pending checklists
    const missingInserts: { checklist_id: string; chore_id: string; checked: boolean; reward_earned: number }[] = []
    const refetchIds = new Set<string>()
    for (const checklist of clList) {
      if (checklist.status === 'approved') continue
      const assigned = asgnMap[checklist.child_id] ?? []
      // If child has no explicit assignments, they get all chores
      const choreIds = assigned.length > 0 ? assigned : (cr ?? []).map(c => c.id)
      const existingChoreIds = new Set(checklist.checklist_items.map(i => i.chore_id))
      for (const choreId of choreIds) {
        if (!existingChoreIds.has(choreId)) {
          missingInserts.push({ checklist_id: checklist.id, chore_id: choreId, checked: false, reward_earned: 0 })
          refetchIds.add(checklist.id)
        }
      }
    }
    if (missingInserts.length > 0) {
      const { error: insertErr } = await supabase.from('checklist_items').insert(missingInserts)
      if (insertErr) console.error('[checklist] missingInserts failed (possible race):', insertErr.message)
      // Re-fetch affected checklists regardless — if insert failed due to a race, the other tab's rows are there
      await Promise.all([...refetchIds].map(async id => {
        const { data: refreshed } = await supabase
          .from('weekly_checklists').select('*, checklist_items(*, chore_templates(*))').eq('id', id).single()
        if (refreshed) {
          const idx = clList.findIndex(c => c.id === id)
          if (idx >= 0) clList[idx] = refreshed as ChecklistWithItems
        }
      }))
    }

    // Build log maps for this week and next week
    const logMap: Record<string, LogEntry[]> = {}
    for (const log of logs ?? []) {
      const key = `${log.child_id}-${log.chore_id}`
      if (!logMap[key]) logMap[key] = []
      logMap[key].push({ id: log.id, logged_at: log.logged_at })
    }
    setTaskLogs(logMap)

    const nextLogMap: Record<string, LogEntry[]> = {}
    for (const log of nextLogs ?? []) {
      const key = `${log.child_id}-${log.chore_id}`
      if (!nextLogMap[key]) nextLogMap[key] = []
      nextLogMap[key].push({ id: log.id, logged_at: log.logged_at })
    }
    setNextTaskLogs(nextLogMap)

    // Sync extra task counts from child logs for all pending checklists (both weeks)
    const syncBatch: PromiseLike<unknown>[] = []
    const bothWeeks: [ChecklistWithItems[], Record<string, LogEntry[]>][] = [
      [clList, logMap],
      [(nextCl ?? []) as ChecklistWithItems[], nextLogMap],
    ]
    for (const [list, lm] of bothWeeks) {
      for (const checklist of list) {
        if (checklist.status === 'approved') continue
        let extraDirty = false
        for (const item of checklist.checklist_items) {
          if (item.chore_templates?.type !== 'extra') continue
          if (item.admin_adjusted) continue  // admin has explicitly set this count — don't overwrite
          const logCount = lm[`${checklist.child_id}-${item.chore_id}`]?.length ?? 0
          if (item.count !== logCount) {
            const reward = logCount * ((item.chore_templates?.reward_amount) ?? (choreMap[item.chore_id]?.reward_amount) ?? 0)
            item.count = logCount
            item.checked = logCount > 0
            item.reward_earned = reward
            extraDirty = true
            syncBatch.push(supabase.from('checklist_items').update({ count: logCount, checked: logCount > 0, reward_earned: reward }).eq('id', item.id).then(() => {}))
          }
        }
        if (extraDirty) {
          const newExtra = checklist.checklist_items.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
          checklist.extra_amount = newExtra
          syncBatch.push(supabase.from('weekly_checklists').update({ extra_amount: newExtra }).eq('id', checklist.id).then(() => {}))
        }
      }
    }
    if (syncBatch.length > 0) await Promise.all(syncBatch)

    const clMap: Record<string, ChecklistWithItems> = {}
    for (const c of clList) clMap[c.child_id] = c
    setChecklists(clMap)

    const nextClMap: Record<string, ChecklistWithItems> = {}
    for (const c of (nextCl ?? []) as ChecklistWithItems[]) nextClMap[c.child_id] = c
    setNextChecklists(nextClMap)

    const missedMap: Record<string, ChecklistWithItems[]> = {}
    for (const c of (olderCl ?? []) as ChecklistWithItems[]) {
      if (!missedMap[c.child_id]) missedMap[c.child_id] = []
      missedMap[c.child_id].push(c)
    }
    setMissedChecklists(missedMap)

    setCompletedTithes(new Set((titheDone ?? []).map(t => t.checklist_id).filter(Boolean)))

    const manualMap: Record<string, ManualTitheRecord[]> = {}
    for (const t of manualTitheData ?? []) {
      if (!manualMap[t.child_id]) manualMap[t.child_id] = []
      manualMap[t.child_id].push(t as ManualTitheRecord)
    }
    setManualTithes(manualMap)

    setLoading(false)
  }, [supabase, weekStart, nextWeekStart])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (loading || children.length === 0) return
    children.forEach(child => {
      const thisWeekCl = checklists[child.id]
      const thisApproved = thisWeekCl?.status === 'approved'
      if (thisApproved) {
        const nextCl = nextChecklists[child.id]
        if (!nextCl || nextCl.checklist_items.length === 0) ensureChecklist(child.id, nextWeekStart)
      } else {
        const childChores = getChildChores(child.id)
        if (!thisWeekCl || thisWeekCl.checklist_items.length === 0) {
          ensureChecklist(child.id, weekStart, childChores.length > 0 ? childChores : undefined)
        }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, children, checklists])

  function getChildChores(childId: string): ChoreTemplate[] {
    const assigned = assignments[childId]
    if (assigned && assigned.length > 0) return chores.filter(c => assigned.includes(c.id))
    return chores
  }

  async function syncNewItems(childId: string, items: (ChecklistItem & { chore_templates: ChoreTemplate })[], checklistId: string, currentExtra: number, logMap: Record<string, LogEntry[]>): Promise<number> {
    const syncBatch: PromiseLike<unknown>[] = []
    let dirty = false
    for (const item of items) {
      if (item.chore_templates?.type !== 'extra') continue
      if (item.admin_adjusted) continue
      const logCount = logMap[`${childId}-${item.chore_id}`]?.length ?? 0
      if (logCount > 0 && item.count !== logCount) {
        const reward = logCount * (item.chore_templates.reward_amount ?? 0)
        item.count = logCount
        item.checked = logCount > 0
        item.reward_earned = reward
        dirty = true
        syncBatch.push(supabase.from('checklist_items').update({ count: logCount, checked: logCount > 0, reward_earned: reward }).eq('id', item.id).then(() => {}))
      }
    }
    if (!dirty) return currentExtra
    const newExtra = items.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    syncBatch.push(supabase.from('weekly_checklists').update({ extra_amount: newExtra }).eq('id', checklistId).then(() => {}))
    await Promise.all(syncBatch)
    return newExtra
  }

  async function ensureChecklist(childId: string, targetWeekStart: string, childChores?: ChoreTemplate[]): Promise<ChecklistWithItems> {
    const isNext = targetWeekStart === nextWeekStart
    const clMap = isNext ? nextChecklists : checklists
    const setClMap = isNext ? setNextChecklists : setChecklists
    const logMap = isNext ? nextTaskLogs : taskLogs

    if (clMap[childId]?.checklist_items.length > 0) return clMap[childId]
    const assigned = childChores ?? getChildChores(childId)
    const choresToUse = assigned.length > 0 ? assigned : chores

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

    // If insert failed (race condition or RLS), try to fetch what's already there
    if (!newCl) {
      const { data: fallback } = await supabase
        .from('weekly_checklists')
        .select('*, checklist_items(*, chore_templates(*))')
        .eq('child_id', childId)
        .eq('week_start', targetWeekStart)
        .single()
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
    setChecklistSaving(child.id)
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

    // Sessions have been counted and paid — clear this week's logs so counts
    // reset to 0 immediately and next week starts fresh
    await supabase.from('extra_task_logs')
      .delete()
      .eq('child_id', child.id)
      .eq('week_start', weekStart)

    setMsg(`Allowance approved for ${child.name}!`)
    load()
    setChecklistSaving(null)
    setTimeout(() => setMsg(''), 3000)
  }

  async function toggleMissedItem(childId: string, missedCl: ChecklistWithItems, itemId: string, chore: ChoreTemplate, checked: boolean) {
    await supabase.from('checklist_items').update({ checked, reward_earned: 0, count: 0 }).eq('id', itemId)
    const updatedItems = missedCl.checklist_items.map(i =>
      i.id === itemId ? { ...i, checked, reward_earned: 0, count: 0 } : i
    )
    const reqAll = updatedItems.filter(i => i.chore_templates?.type === 'required').every(i => i.checked)
    const baseAmount = reqAll && updatedItems.filter(i => i.chore_templates?.type === 'required').length > 0 ? defaultAllowance : 0
    const extraAmount = updatedItems.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    await supabase.from('weekly_checklists').update({ base_amount: baseAmount, extra_amount: extraAmount }).eq('id', missedCl.id)
    setMissedChecklists(prev => ({
      ...prev,
      [childId]: (prev[childId] ?? []).map(c =>
        c.id === missedCl.id ? { ...c, base_amount: baseAmount, extra_amount: extraAmount, checklist_items: updatedItems } as ChecklistWithItems : c
      ),
    }))
  }

  async function setMissedExtraCount(childId: string, missedCl: ChecklistWithItems, itemId: string, chore: ChoreTemplate, count: number) {
    const reward = count * (chore.reward_amount ?? 0)
    await supabase.from('checklist_items').update({ count, checked: count > 0, reward_earned: reward, admin_adjusted: true }).eq('id', itemId)
    const updatedItems = missedCl.checklist_items.map(i =>
      i.id === itemId ? { ...i, count, checked: count > 0, reward_earned: reward } : i
    )
    const reqAll = updatedItems.filter(i => i.chore_templates?.type === 'required').every(i => i.checked)
    const baseAmount = reqAll && updatedItems.filter(i => i.chore_templates?.type === 'required').length > 0 ? defaultAllowance : 0
    const extraAmount = updatedItems.filter(i => i.chore_templates?.type === 'extra').reduce((s, i) => s + i.reward_earned, 0)
    await supabase.from('weekly_checklists').update({ base_amount: baseAmount, extra_amount: extraAmount }).eq('id', missedCl.id)
    setMissedChecklists(prev => ({
      ...prev,
      [childId]: (prev[childId] ?? []).map(c =>
        c.id === missedCl.id ? { ...c, base_amount: baseAmount, extra_amount: extraAmount, checklist_items: updatedItems } as ChecklistWithItems : c
      ),
    }))
  }

  async function dismissMissedWeek(child: Profile, missedCl: ChecklistWithItems) {
    setMissedSaving(missedCl.id)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('weekly_checklists').update({
      status: 'approved',
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', missedCl.id)
    await supabase.from('extra_task_logs').delete().eq('child_id', child.id).eq('week_start', missedCl.week_start)
    load()
    setMissedSaving(null)
  }

  async function approveMissedAllowance(child: Profile, missedCl: ChecklistWithItems) {
    setMissedSaving(missedCl.id)
    setMsg('')
    const total = missedCl.base_amount + missedCl.extra_amount
    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('weekly_checklists').update({
      status: 'approved',
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', missedCl.id)

    if (total > 0) {
      const { data: settings } = await supabase.from('app_settings').select('value').eq('key', 'tithe_percentage').single()
      const pct = parseFloat(settings?.value ?? '10')
      await supabase.from('tithe_records').insert({
        child_id: child.id,
        checklist_id: missedCl.id,
        income_amount: total,
        tithe_amount: Math.ceil(total * pct / 100),
        tithe_percentage: pct,
        completed: false,
      })
    }

    await supabase.from('extra_task_logs')
      .delete()
      .eq('child_id', child.id)
      .eq('week_start', missedCl.week_start)

    setMsg(`Approved missed week for ${child.name}!`)
    load()
    setMissedSaving(null)
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

  async function loadWeekHistory(childId: string) {
    if (weekHistory[childId] !== undefined || weekHistoryLoading.has(childId)) return
    setWeekHistoryLoading(prev => new Set(prev).add(childId))

    // Last 12 weeks
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 84)
    const y = cutoff.getFullYear()
    const m = String(cutoff.getMonth() + 1).padStart(2, '0')
    const d = String(cutoff.getDate()).padStart(2, '0')
    const cutoffStr = `${y}-${m}-${d}`

    const { data } = await supabase
      .from('weekly_checklists')
      .select('*, checklist_items(*, chore_templates(*))')
      .eq('child_id', childId)
      .eq('status', 'approved')
      .gte('week_start', cutoffStr)
      .order('week_start', { ascending: false })

    const weeks = (data ?? []) as ChecklistWithItems[]
    setWeekHistory(prev => ({ ...prev, [childId]: weeks }))

    // Resolve any approver names we haven't cached yet
    const unknownIds = [...new Set(weeks.map(w => w.approved_by).filter((id): id is string => !!id))]
      .filter(id => !adminNames[id])
    if (unknownIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', unknownIds)
      if (profiles) setAdminNames(prev => ({ ...prev, ...Object.fromEntries(profiles.map(p => [p.id, p.name])) }))
    }

    setWeekHistoryLoading(prev => { const s = new Set(prev); s.delete(childId); return s })
  }



  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Children</h1>
        <p style={{ color: '#64748b', marginTop: '0.25rem', fontSize: '0.9rem' }}>
          Week of {new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {msg && (
        <div style={{
          background: msg.toLowerCase().includes('error') || msg.toLowerCase().includes('denied') ? '#fee2e2' : '#dcfce7',
          color: msg.toLowerCase().includes('error') || msg.toLowerCase().includes('denied') ? '#991b1b' : '#15803d',
          padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.875rem',
        }}>{msg}</div>
      )}


      {children.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👧</div>
          <p style={{ color: '#64748b' }}>No children accounts yet. Add your first child above.</p>
        </div>
      ) : (
        children.map(child => {
          const section = activeSection[child.id] ?? null
          const thisWeekCl = checklists[child.id]
          const thisApproved = thisWeekCl?.status === 'approved'
          const cl = thisApproved ? nextChecklists[child.id] : thisWeekCl
          const items = cl?.checklist_items ?? []
          const total = (cl?.base_amount ?? 0) + (cl?.extra_amount ?? 0)
          const reqItems = items.filter(i => i.chore_templates?.type === 'required')
          const extraItems = items.filter(i => i.chore_templates?.type === 'extra')
          const reqAllChecked = reqItems.length > 0 && reqItems.every(i => i.checked)
          const activeLogs = thisApproved ? nextTaskLogs : taskLogs
          const activeWeekStart = thisApproved ? nextWeekStart : weekStart
          const isActiveWeekToday = todayStr >= activeWeekStart
          const childWithdrawals = withdrawals.filter(w => w.child_id === child.id)
          const adjustForm = adjustForms[child.id] ?? { amount: '', description: '', type: 'deposit' as const, tithe: false }
          const assignedIds = assignments[child.id]
          const extrasForChild = chores.filter(c =>
            c.type === 'extra' && (assignedIds && assignedIds.length > 0 ? assignedIds.includes(c.id) : true)
          )

          const tabs = [
            {
              key: 'checklist' as SectionKey,
              label: '✅ Checklist',
              badge: total > 0 ? formatMoney(total) : null,
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
              label: '🧮 Add/Remove',
              badge: null,
              badgeBg: '', badgeColor: '',
            },
            {
              key: 'history' as SectionKey,
              label: '📊 Transactions',
              badge: null,
              badgeBg: '', badgeColor: '',
            },
            {
              key: 'weeks' as SectionKey,
              label: '📅 AllowanceLog',
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
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: child.balance >= 0 ? '#16a34a' : '#dc2626' }}>
                    {formatMoney(child.balance)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>balance</div>
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
                      if (tab.key === 'weeks') loadWeekHistory(child.id)
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
                  {/* Missed weeks — full checklist per week, oldest first */}
                  {(missedChecklists[child.id] ?? []).map(missedCl => {
                    const missedTotal = missedCl.base_amount + missedCl.extra_amount
                    const missedReqItems = missedCl.checklist_items.filter(i => i.chore_templates?.type === 'required')
                    const missedExtraItems = missedCl.checklist_items.filter(i => i.chore_templates?.type === 'extra')
                    const missedReqAllChecked = missedReqItems.length > 0 && missedReqItems.every(i => i.checked)
                    const weekLabel = new Date(missedCl.week_start + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                    return (
                      <div key={missedCl.id} style={{ border: '2px solid #fde047', borderRadius: '0.75rem', overflow: 'hidden', marginBottom: '1.25rem' }}>
                        {/* Missed week header */}
                        <div style={{ background: '#fefce8', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span>⚠️</span>
                          <div style={{ fontWeight: 700, color: '#854d0e', flex: 1, fontSize: '0.9rem' }}>
                            Unapproved — week of {weekLabel}
                          </div>
                          <button
                            onClick={() => dismissMissedWeek(child, missedCl)}
                            disabled={missedSaving === missedCl.id}
                            style={{
                              background: 'white', border: '1px solid #e2e8f0', borderRadius: '0.5rem',
                              padding: '0.3rem 0.75rem', fontSize: '0.78rem', color: '#64748b',
                              cursor: 'pointer', fontWeight: 600,
                            }}
                          >
                            Dismiss (already paid)
                          </button>
                        </div>

                        {/* Missed week body */}
                        <div style={{ padding: '1rem', background: 'white' }}>
                          {/* Part 1 */}
                          <div style={{ marginBottom: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                              <span style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
                                PART 1 — Required
                              </span>
                              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>All checked = {formatMoney(defaultAllowance)}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                              {missedReqItems.map(item => {
                                const chore = item.chore_templates
                                if (!chore) return null
                                return (
                                  <label key={item.id} style={{
                                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                                    padding: '0.5rem 0.75rem',
                                    background: item.checked ? '#f0fdf4' : '#f8fafc',
                                    borderRadius: '0.5rem', cursor: 'pointer',
                                    border: `1px solid ${item.checked ? '#bbf7d0' : '#e2e8f0'}`,
                                  }}>
                                    <input type="checkbox" checked={item.checked}
                                      onChange={e => toggleMissedItem(child.id, missedCl, item.id, chore, e.target.checked)}
                                      style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#16a34a' }} />
                                    <span style={{ fontWeight: 500, flex: 1, fontSize: '0.875rem' }}>{chore.name}</span>
                                    {item.checked && <span style={{ color: '#16a34a', fontSize: '0.8rem', fontWeight: 600 }}>✓</span>}
                                  </label>
                                )
                              })}
                              {missedReqItems.length === 0 && (
                                <p style={{ color: '#94a3b8', fontSize: '0.825rem', padding: '0.25rem 0' }}>No required chores.</p>
                              )}
                            </div>
                            {missedReqAllChecked && (
                              <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#15803d', fontWeight: 600 }}>
                                ✅ All done! Base: {formatMoney(defaultAllowance)}
                              </div>
                            )}
                          </div>

                          {/* Part 2 */}
                          {extrasForChild.length > 0 && (
                            <div style={{ marginBottom: '1rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                                <span style={{ background: '#fef3c7', color: '#d97706', fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
                                  PART 2 — Extra Rewards
                                </span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                {extrasForChild.map(chore => {
                                  const item = missedExtraItems.find(i => i.chore_id === chore.id)
                                  if (!item) return null
                                  const count = item.count ?? 0
                                  const earned = count * (chore.reward_amount ?? 0)
                                  return (
                                    <div key={chore.id} style={{
                                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                                      padding: '0.5rem 0.75rem',
                                      background: count > 0 ? '#fffbeb' : '#f8fafc',
                                      borderRadius: '0.5rem',
                                      border: `1px solid ${count > 0 ? '#fde68a' : '#e2e8f0'}`,
                                    }}>
                                      <span style={{ fontWeight: 500, flex: 1, fontSize: '0.875rem' }}>{chore.name}</span>
                                      <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{formatMoney(chore.reward_amount ?? 0)}/session</span>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                        <button
                                          onClick={() => setMissedExtraCount(child.id, missedCl, item.id, chore, count - 1)}
                                          disabled={count === 0}
                                          style={{
                                            width: '22px', height: '22px', borderRadius: '50%',
                                            border: '1.5px solid #e2e8f0', background: 'white',
                                            fontSize: '0.9rem', fontWeight: 700,
                                            cursor: count === 0 ? 'not-allowed' : 'pointer',
                                            opacity: count === 0 ? 0.35 : 1, color: '#374151',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          }}
                                        >−</button>
                                        <span style={{ minWidth: '1.25rem', textAlign: 'center', fontWeight: 700, fontSize: '0.9rem', color: count > 0 ? '#d97706' : '#94a3b8' }}>{count}</span>
                                        <button
                                          onClick={() => setMissedExtraCount(child.id, missedCl, item.id, chore, count + 1)}
                                          style={{
                                            width: '22px', height: '22px', borderRadius: '50%',
                                            border: '1.5px solid #e2e8f0', background: 'white',
                                            fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', color: '#374151',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          }}
                                        >+</button>
                                      </div>
                                      <span style={{
                                        background: count > 0 ? '#fef3c7' : '#f1f5f9',
                                        color: count > 0 ? '#d97706' : '#94a3b8',
                                        fontSize: '0.78rem', fontWeight: 700,
                                        padding: '0.1rem 0.45rem', borderRadius: '999px',
                                        minWidth: '2.5rem', textAlign: 'right',
                                      }}>+{formatMoney(earned)}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          {/* Summary + Approve */}
                          <div style={{
                            background: '#f8fafc', borderRadius: '0.625rem',
                            padding: '0.875rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                          }}>
                            <div style={{ flex: 1, display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                              <div>
                                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>Base</div>
                                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatMoney(missedCl.base_amount)}</div>
                              </div>
                              {missedCl.extra_amount > 0 && (
                                <div>
                                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>Extras</div>
                                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#d97706' }}>{formatMoney(missedCl.extra_amount)}</div>
                                </div>
                              )}
                              <div>
                                <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>Total</div>
                                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#16a34a' }}>{formatMoney(missedTotal)}</div>
                              </div>
                            </div>
                            <button
                              className="btn-primary"
                              onClick={() => approveMissedAllowance(child, missedCl)}
                              disabled={missedSaving === missedCl.id || missedTotal === 0}
                              style={{ fontSize: '0.875rem' }}
                            >
                              {missedSaving === missedCl.id ? 'Approving...' : `Approve & Pay ${formatMoney(missedTotal)}`}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  <>
                      {/* Tithe pending for the approved week */}
                      {thisApproved && !completedTithes.has(thisWeekCl?.id ?? '') && (
                        <div style={{
                          background: '#fefce8', border: '1px solid #fde047',
                          borderRadius: '0.75rem', padding: '1rem', marginBottom: '1.25rem',
                          display: 'flex', alignItems: 'center', gap: '0.75rem',
                          color: '#854d0e', fontWeight: 600,
                        }}>
                          <span style={{ fontSize: '1.25rem' }}>⏳</span>
                          {`This week approved — waiting for tithe decision`}
                        </div>
                      )}
                      {thisApproved && (
                        <div style={{
                          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.75rem',
                          padding: '0.625rem 1rem', marginBottom: '1.25rem',
                          display: 'flex', alignItems: 'center', gap: '0.5rem',
                          color: '#15803d', fontWeight: 600, fontSize: '0.875rem',
                        }}>
                          <span>✅</span>
                          <span>This week approved — showing next week&apos;s checklist</span>
                        </div>
                      )}
                      {!isActiveWeekToday && !thisApproved && (
                        <div style={{
                          background: '#f8fafc', border: '1px solid #e2e8f0',
                          borderRadius: '0.75rem', padding: '0.75rem 1rem',
                          color: '#64748b', fontSize: '0.875rem', marginBottom: '1.25rem',
                        }}>
                          📅 Checklist can only be checked and approved on Saturday
                        </div>
                      )}
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
                                borderRadius: '0.625rem', cursor: isSaturday ? 'pointer' : 'default',
                                border: `1px solid ${item.checked ? '#bbf7d0' : '#e2e8f0'}`,
                                transition: 'all 0.15s',
                              }}>
                                <input type="checkbox" checked={item.checked}
                                  onChange={e => isActiveWeekToday && toggleItem(child.id, item.id, chore, e.target.checked)}
                                  disabled={!isActiveWeekToday}
                                  style={{ width: '17px', height: '17px', cursor: isActiveWeekToday ? 'pointer' : 'not-allowed', accentColor: '#16a34a' }} />
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

                      {/* Part 2: Extra Rewards */}
                      {extrasForChild.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                            <span style={{ background: '#fef3c7', color: '#d97706', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                              PART 2 — Extra Rewards
                            </span>
                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>From child records — adjust if needed</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {extrasForChild.map(chore => {
                              const item = extraItems.find(i => i.chore_id === chore.id)
                              if (!item) return null
                              const count = item.count ?? 0
                              const earned = count * (chore.reward_amount ?? 0)
                              const logKey = `${child.id}-${chore.id}`
                              const logs = activeLogs[logKey] ?? []
                              const isExpanded = expandedLogs[logKey] ?? false
                              return (
                                <div key={chore.id} style={{ border: `1px solid ${count > 0 ? '#fde68a' : '#e2e8f0'}`, borderRadius: '0.625rem', overflow: 'hidden' }}>
                                  <div style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    padding: '0.625rem 0.875rem',
                                    background: count > 0 ? '#fffbeb' : '#f8fafc',
                                  }}>
                                    <span style={{ fontWeight: 500, flex: 1, fontSize: '0.9rem' }}>{chore.name}</span>
                                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', flexShrink: 0 }}>{formatMoney(chore.reward_amount ?? 0)}/session</span>
                                    <button
                                      onClick={() => setExpandedLogs(prev => ({ ...prev, [logKey]: !isExpanded }))}
                                      style={{
                                        display: 'flex', alignItems: 'center', gap: '0.25rem',
                                        background: logs.length > 0 ? '#e0f2fe' : '#f1f5f9',
                                        color: logs.length > 0 ? '#0369a1' : '#94a3b8',
                                        border: 'none', borderRadius: '999px',
                                        padding: '0.2rem 0.55rem',
                                        fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                                      }}
                                    >
                                      📱 {logs.length} <span style={{ fontSize: '0.55rem' }}>{isExpanded ? '▲' : '▼'}</span>
                                    </button>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', flexShrink: 0 }}>
                                      <button
                                        onClick={() => setExtraCount(child.id, item.id, chore, count - 1)}
                                        disabled={count === 0}
                                        style={{
                                          width: '24px', height: '24px', borderRadius: '50%',
                                          border: '1.5px solid #e2e8f0', background: 'white',
                                          fontSize: '0.95rem', fontWeight: 700,
                                          cursor: count === 0 ? 'not-allowed' : 'pointer',
                                          opacity: count === 0 ? 0.35 : 1, color: '#374151',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}
                                      >−</button>
                                      <span style={{
                                        minWidth: '1.5rem', textAlign: 'center',
                                        fontWeight: 700, fontSize: '0.95rem',
                                        color: count > 0 ? '#d97706' : '#94a3b8',
                                      }}>{count}</span>
                                      <button
                                        onClick={() => setExtraCount(child.id, item.id, chore, count + 1)}
                                        style={{
                                          width: '24px', height: '24px', borderRadius: '50%',
                                          border: '1.5px solid #e2e8f0', background: 'white',
                                          fontSize: '0.95rem', fontWeight: 700,
                                          cursor: 'pointer', color: '#374151',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}
                                      >+</button>
                                    </div>
                                    <span style={{
                                      background: count > 0 ? '#fef3c7' : '#f1f5f9',
                                      color: count > 0 ? '#d97706' : '#94a3b8',
                                      fontSize: '0.8rem', fontWeight: 700,
                                      padding: '0.15rem 0.5rem', borderRadius: '999px',
                                      minWidth: '2.75rem', textAlign: 'right', flexShrink: 0,
                                    }}>+{formatMoney(earned)}</span>
                                  </div>
                                  {isExpanded && (
                                    <div style={{ borderTop: '1px solid #e2e8f0', background: 'white' }}>
                                      {logs.length === 0 ? (
                                        <div style={{ padding: '0.5rem 0.875rem', fontSize: '0.78rem', color: '#94a3b8' }}>
                                          No sessions recorded by child this week.
                                        </div>
                                      ) : (
                                        logs.map((log, i) => (
                                          <div key={log.id} style={{
                                            padding: '0.35rem 0.875rem',
                                            borderBottom: i < logs.length - 1 ? '1px solid #f8fafc' : 'none',
                                            fontSize: '0.75rem', color: '#64748b',
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
                          disabled={checklistSaving === child.id || total === 0 || !isActiveWeekToday}
                        >
                          {checklistSaving === child.id
                            ? 'Approving...'
                            : !isActiveWeekToday
                              ? `Available ${new Date(activeWeekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                              : `Approve & Pay ${formatMoney(total)}`}
                        </button>
                      </div>
                    </>
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


              {/* Weeks (allowance history) section */}
              {section === 'weeks' && (() => {
                const weeks = weekHistory[child.id]
                return (
                  <div style={{ padding: '1.5rem' }}>
                    {weekHistoryLoading.has(child.id) ? (
                      <p style={{ color: '#94a3b8', textAlign: 'center', padding: '1.5rem 0' }}>Loading...</p>
                    ) : !weeks || weeks.length === 0 ? (
                      <p style={{ color: '#94a3b8', textAlign: 'center', padding: '1.5rem 0' }}>No approved weeks in the last 3 months.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                        {weeks.map(week => {
                          const isOpen = expandedWeeks[week.id] ?? false
                          const satDate = new Date(week.week_start + 'T12:00:00')
                          const sunDate = new Date(satDate)
                          sunDate.setDate(sunDate.getDate() - 6)
                          const sameMonth = sunDate.getMonth() === satDate.getMonth()
                          const weekLabel = `${sunDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${satDate.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`
                          const approvedLabel = week.approved_at
                            ? new Date(week.approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : null
                          const approverName = week.approved_by ? (adminNames[week.approved_by] ?? '…') : null
                          const total = week.base_amount + week.extra_amount
                          const reqItems = (week.checklist_items ?? []).filter(i => i.chore_templates?.type === 'required')
                          const extraItems = (week.checklist_items ?? []).filter(i => i.chore_templates?.type === 'extra' && i.reward_earned > 0)

                          return (
                            <div key={week.id} style={{ border: '1px solid #e2e8f0', borderRadius: '0.875rem', overflow: 'hidden' }}>
                              {/* Header row — always visible */}
                              <button
                                onClick={() => setExpandedWeeks(prev => ({ ...prev, [week.id]: !isOpen }))}
                                style={{
                                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                                  padding: '0.75rem 1rem', background: '#f8fafc',
                                  border: 'none', cursor: 'pointer', textAlign: 'left',
                                }}
                              >
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b' }}>
                                    Week {weekLabel}
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.1rem' }}>
                                    {approvedLabel && approverName
                                      ? `Approved ${approvedLabel} · by ${approverName}`
                                      : approvedLabel
                                        ? `Approved ${approvedLabel}`
                                        : 'Approved'}
                                  </div>
                                </div>
                                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#16a34a', flexShrink: 0 }}>
                                  {formatMoney(total)}
                                </div>
                                <span style={{ fontSize: '0.7rem', color: '#94a3b8', flexShrink: 0 }}>
                                  {isOpen ? '▲' : '▼'}
                                </span>
                              </button>

                              {/* Expanded detail */}
                              {isOpen && (
                                <div style={{ padding: '1rem', borderTop: '1px solid #e2e8f0', background: 'white' }}>
                                  {/* Part I */}
                                  <div style={{ marginBottom: '0.875rem' }}>
                                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                                      Part I — Required Chores
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                      {reqItems.map(item => (
                                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                                          <span style={{ color: item.checked ? '#16a34a' : '#dc2626', fontWeight: 700, flexShrink: 0 }}>
                                            {item.checked ? '✓' : '✗'}
                                          </span>
                                          <span style={{ color: item.checked ? '#374151' : '#94a3b8' }}>
                                            {item.chore_templates?.name ?? '—'}
                                          </span>
                                        </div>
                                      ))}
                                      {reqItems.length === 0 && (
                                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>No required chores recorded.</span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Part II */}
                                  {extraItems.length > 0 && (
                                    <div style={{ marginBottom: '0.875rem' }}>
                                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                                        Part II — Extra Tasks
                                      </div>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                        {extraItems.map(item => (
                                          <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                            <span style={{ color: '#374151' }}>
                                              {item.chore_templates?.name ?? '—'}
                                              <span style={{ color: '#94a3b8', marginLeft: '0.35rem' }}>
                                                ×{Math.round(item.reward_earned / (item.chore_templates?.reward_amount ?? 1))}
                                              </span>
                                            </span>
                                            <span style={{ color: '#16a34a', fontWeight: 600 }}>
                                              +{formatMoney(item.reward_earned)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Totals footer */}
                                  <div style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    paddingTop: '0.625rem', borderTop: '1px solid #f1f5f9',
                                    fontSize: '0.82rem', color: '#64748b',
                                  }}>
                                    <span>Base {formatMoney(week.base_amount)}{week.extra_amount > 0 ? ` + Extra ${formatMoney(week.extra_amount)}` : ''}</span>
                                    <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem' }}>
                                      Total {formatMoney(total)}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })()}

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
