'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChoreTemplate } from '@/lib/types'

interface ExtraTaskLog {
  id: string
  chore_id: string
  logged_at: string
}

function getThisSaturday() {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 6 ? 0 : 6 - day
  d.setDate(d.getDate() + diff)
  // Use local date parts — toISOString() returns UTC which is one day behind SGT before 8am
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${dd}`
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

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function formatMoney(n: number) {
  return '$' + Math.ceil(n).toLocaleString()
}

export default function TasksPage() {
  const supabase = createClient()
  const [required, setRequired] = useState<ChoreTemplate[]>([])
  const [extras, setExtras] = useState<ChoreTemplate[]>([])
  const [logs, setLogs] = useState<ExtraTaskLog[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [adding, setAdding] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [weekStart, setWeekStart] = useState(getThisSaturday())
  const [nextWeekMode, setNextWeekMode] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const thisSaturday = getThisSaturday()
    const nextSaturday = getNextSaturday()

    // If this week's checklist is already approved, record for next week instead
    const { data: thisWeekCl } = await supabase
      .from('weekly_checklists')
      .select('status')
      .eq('child_id', user.id)
      .eq('week_start', thisSaturday)
      .maybeSingle()

    const activeWeek = thisWeekCl?.status === 'approved' ? nextSaturday : thisSaturday
    setWeekStart(activeWeek)
    setNextWeekMode(thisWeekCl?.status === 'approved')

    const [{ data: chores }, { data: logData }, { data: assignData }] = await Promise.all([
      supabase.from('chore_templates').select('*').eq('active', true).order('sort_order'),
      supabase.from('extra_task_logs')
        .select('id, chore_id, logged_at')
        .eq('child_id', user.id)
        .eq('week_start', activeWeek)
        .order('logged_at', { ascending: false }),
      supabase.from('chore_assignments').select('chore_id').eq('child_id', user.id),
    ])

    const assignedIds = new Set((assignData ?? []).map(a => a.chore_id))
    setRequired((chores ?? []).filter(c => c.type === 'required' && (assignedIds.size === 0 || assignedIds.has(c.id))))
    setExtras((chores ?? []).filter(c => c.type === 'extra' && (assignedIds.size === 0 || assignedIds.has(c.id))))
    setLogs(logData ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function addLog(choreId: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || adding) return
    setAdding(choreId)
    await supabase.from('extra_task_logs').insert({
      child_id: user.id,
      chore_id: choreId,
      week_start: weekStart,
    })
    await load()
    setAdding(null)
  }

  async function deleteLog(logId: string) {
    setDeleting(logId)
    await supabase.from('extra_task_logs').delete().eq('id', logId)
    setLogs(prev => prev.filter(l => l.id !== logId))
    setDeleting(null)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh', color: '#94a3b8' }}>
      Loading...
    </div>
  )

  const weekLabel = new Date(weekStart + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, color: '#1e293b' }}>My Works</h1>
        <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          {nextWeekMode ? `Next week · ${weekLabel}` : `Week of ${weekLabel}`}
        </p>
      </div>

      {nextWeekMode && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.75rem',
          padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#15803d', fontWeight: 500,
        }}>
          This week&apos;s allowance is approved! Any extra sessions you log now count for next week.
        </div>
      )}

      {/* Part I — Required chores (read-only reminder) */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <span style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
            PART I — Required
          </span>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Your weekly essentials</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {required.map(chore => (
            <div key={chore.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.625rem 0.875rem',
              background: '#f8fafc', borderRadius: '0.625rem',
              border: '1px solid #e2e8f0',
            }}>
              <span>📋</span>
              <span style={{ fontWeight: 500, color: '#374151' }}>{chore.name}</span>
            </div>
          ))}
          {required.length === 0 && (
            <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>No required chores set yet.</p>
          )}
        </div>
      </div>

      {/* Part II — Extra tasks */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <span style={{ background: '#fef3c7', color: '#d97706', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
            PART II — Extra Rewards
          </span>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Tap +1 each time you finish a session</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {extras.map(chore => {
            const choreLogs = logs.filter(l => l.chore_id === chore.id)
            const count = choreLogs.length
            const isExpanded = expanded[chore.id] ?? false

            return (
              <div key={chore.id} style={{ border: '1px solid #e2e8f0', borderRadius: '0.875rem', overflow: 'hidden' }}>
                {/* Main row */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  background: count > 0 ? '#fffbeb' : '#f8fafc',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.95rem' }}>{chore.name}</div>
                    <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{formatMoney(chore.reward_amount ?? 0)} / session</div>
                  </div>

                  {/* Session count — tap to view log */}
                  <button
                    onClick={() => setExpanded(prev => ({ ...prev, [chore.id]: !isExpanded }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.3rem',
                      background: count > 0 ? '#fde68a' : '#e2e8f0',
                      color: count > 0 ? '#92400e' : '#64748b',
                      border: 'none', borderRadius: '999px',
                      padding: '0.3rem 0.75rem',
                      fontWeight: 700, fontSize: '0.875rem',
                      cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    ×{count}
                    <span style={{ fontSize: '0.65rem' }}>{isExpanded ? '▲' : '▼'}</span>
                  </button>

                  {/* +1 button */}
                  <button
                    onClick={() => addLog(chore.id)}
                    disabled={adding === chore.id}
                    style={{
                      background: '#16a34a', color: 'white',
                      border: 'none', borderRadius: '0.625rem',
                      padding: '0.45rem 1rem',
                      fontWeight: 700, fontSize: '1rem',
                      cursor: adding === chore.id ? 'not-allowed' : 'pointer',
                      opacity: adding === chore.id ? 0.6 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {adding === chore.id ? '…' : '+1'}
                  </button>
                </div>

                {/* Expandable log entries */}
                {isExpanded && (
                  <div style={{ borderTop: '1px solid #e2e8f0', background: 'white' }}>
                    {choreLogs.length === 0 ? (
                      <div style={{ padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                        No sessions recorded this week yet.
                      </div>
                    ) : (
                      choreLogs.map((log, i) => (
                        <div key={log.id} style={{
                          display: 'flex', alignItems: 'center',
                          padding: '0.5rem 1rem',
                          borderBottom: i < choreLogs.length - 1 ? '1px solid #f1f5f9' : 'none',
                          background: deleting === log.id ? '#fef2f2' : 'white',
                          transition: 'background 0.1s',
                        }}>
                          <span style={{ fontSize: '0.78rem', color: '#64748b', flex: 1 }}>
                            Session {choreLogs.length - i} · {formatDateTime(log.logged_at)}
                          </span>
                          <button
                            onClick={() => deleteLog(log.id)}
                            disabled={deleting === log.id}
                            style={{
                              background: 'none', border: 'none',
                              color: '#ef4444', fontSize: '0.78rem',
                              cursor: deleting === log.id ? 'not-allowed' : 'pointer',
                              padding: '0.2rem 0.5rem',
                              opacity: deleting === log.id ? 0.4 : 1,
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {extras.length === 0 && (
            <p style={{ color: '#94a3b8', fontSize: '0.875rem' }}>No extra tasks set yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}
