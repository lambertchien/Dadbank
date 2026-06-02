'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChoreTemplate, SpendingCategory, Profile } from '@/lib/types'

export default function SettingsPage() {
  const supabase = createClient()
  const [settings, setSettings] = useState({ default_allowance: '100', interest_rate: '1', tithe_percentage: '10' })
  const [notifEmail, setNotifEmail] = useState('')
  const [chores, setChores] = useState<ChoreTemplate[]>([])
  const [categories, setCategories] = useState<SpendingCategory[]>([])
  const [children, setChildren] = useState<Profile[]>([])
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [newChore, setNewChore] = useState({ name: '', type: 'required' as 'required' | 'extra', reward_amount: '' })
  const [newCategory, setNewCategory] = useState('')
  const [saving, setSaving] = useState('')
  const [msg, setMsg] = useState('')
  const [editingReward, setEditingReward] = useState<Record<string, string>>({})

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwMsgOk, setPwMsgOk] = useState(true)

  const load = useCallback(async () => {
    const [{ data: s }, { data: cr }, { data: cat }, { data: ch }, { data: asgn }, { data: { user } }] = await Promise.all([
      supabase.from('app_settings').select('*'),
      supabase.from('chore_templates').select('*').order('type').order('sort_order'),
      supabase.from('spending_categories').select('*').order('sort_order'),
      supabase.from('profiles').select('*').eq('role', 'child').order('name'),
      supabase.from('chore_assignments').select('child_id, chore_id'),
      supabase.auth.getUser(),
    ])

    const map: Record<string, string> = {}
    for (const row of s ?? []) map[row.key] = row.value
    setSettings({
      default_allowance: map.default_allowance ?? '100',
      interest_rate: parseFloat(map.interest_rate ?? '1').toFixed(1),
      tithe_percentage: parseFloat(map.tithe_percentage ?? '10').toFixed(1),
    })
    setChores(cr ?? [])
    setCategories(cat ?? [])
    setChildren(ch ?? [])

    const asgnMap: Record<string, string[]> = {}
    for (const a of asgn ?? []) {
      if (!asgnMap[a.child_id]) asgnMap[a.child_id] = []
      asgnMap[a.child_id].push(a.chore_id)
    }
    setAssignments(asgnMap)

    if (user) {
      const { data: profile } = await supabase.from('profiles').select('notification_email').eq('id', user.id).single()
      setNotifEmail(profile?.notification_email ?? '')
    }
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function saveSetting(key: string, value: string) {
    setSaving(key)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('app_settings').upsert({ key, value, updated_by: user?.id, updated_at: new Date().toISOString() })
    setMsg(`Saved!`)
    setSaving('')
    setTimeout(() => setMsg(''), 2000)
  }

  async function saveNotifEmail() {
    setSaving('notif')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('profiles').update({ notification_email: notifEmail }).eq('id', user.id)
    setMsg('Notification email saved!')
    setSaving('')
    setTimeout(() => setMsg(''), 2000)
  }

  async function changePassword() {
    if (newPassword.length < 6) { setPwMsgOk(false); setPwMsg('Password must be at least 6 characters'); return }
    if (newPassword !== confirmPassword) { setPwMsgOk(false); setPwMsg('Passwords do not match'); return }
    setSaving('password')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) { setPwMsgOk(false); setPwMsg(error.message); setSaving(''); return }
    setPwMsgOk(true)
    setPwMsg('Password updated!')
    setNewPassword('')
    setConfirmPassword('')
    setSaving('')
    setTimeout(() => setPwMsg(''), 3000)
  }

  async function addChore() {
    if (!newChore.name) return
    setSaving('chore')
    const maxSort = chores.filter(c => c.type === newChore.type).length
    await supabase.from('chore_templates').insert({
      name: newChore.name,
      type: newChore.type,
      reward_amount: newChore.type === 'extra' ? parseFloat(newChore.reward_amount) || 0 : null,
      active: true,
      sort_order: maxSort + 1,
    })
    setNewChore({ name: '', type: 'required', reward_amount: '' })
    setMsg('Chore added!')
    setSaving('')
    load()
    setTimeout(() => setMsg(''), 2000)
  }

  async function toggleChore(id: string, active: boolean) {
    await supabase.from('chore_templates').update({ active }).eq('id', id)
    setChores(prev => prev.map(c => c.id === id ? { ...c, active } : c))
  }

  async function deleteChore(id: string) {
    await supabase.from('chore_templates').delete().eq('id', id)
    setChores(prev => prev.filter(c => c.id !== id))
  }

  async function saveReward(id: string) {
    const val = parseFloat(editingReward[id] ?? '')
    if (isNaN(val) || val < 0) return
    await supabase.from('chore_templates').update({ reward_amount: val }).eq('id', id)
    setChores(prev => prev.map(c => c.id === id ? { ...c, reward_amount: val } : c))
    setEditingReward(prev => { const n = { ...prev }; delete n[id]; return n })
    setMsg('Reward updated!')
    setTimeout(() => setMsg(''), 2000)
  }

  function getThisSaturday() {
    const d = new Date()
    const day = d.getDay()
    d.setDate(d.getDate() + (day === 6 ? 0 : 6 - day))
    return d.toISOString().split('T')[0]
  }

  async function toggleAssignment(choreId: string, childId: string, assign: boolean) {
    if (assign) {
      await supabase.from('chore_assignments').insert({ chore_id: choreId, child_id: childId })
      setAssignments(prev => ({ ...prev, [childId]: [...(prev[childId] ?? []), choreId] }))
    } else {
      const { count } = await supabase
        .from('extra_task_logs')
        .select('id', { count: 'exact', head: true })
        .eq('child_id', childId)
        .eq('chore_id', choreId)
        .eq('week_start', getThisSaturday())
      if ((count ?? 0) > 0) {
        setMsg(`Can't remove — ${count} session(s) logged this week. Set the count to 0 in the checklist first.`)
        setTimeout(() => setMsg(''), 4000)
        return
      }
      await supabase.from('chore_assignments').delete().eq('chore_id', choreId).eq('child_id', childId)
      setAssignments(prev => ({ ...prev, [childId]: (prev[childId] ?? []).filter(id => id !== choreId) }))
    }
  }

  async function addCategory() {
    if (!newCategory.trim()) return
    const maxSort = categories.length
    await supabase.from('spending_categories').insert({ name: newCategory.trim(), active: true, sort_order: maxSort + 1 })
    setNewCategory('')
    load()
  }

  async function toggleCategory(id: string, active: boolean) {
    await supabase.from('spending_categories').update({ active }).eq('id', id)
    setCategories(prev => prev.map(c => c.id === id ? { ...c, active } : c))
  }

  async function deleteCategory(id: string) {
    await supabase.from('spending_categories').delete().eq('id', id)
    setCategories(prev => prev.filter(c => c.id !== id))
  }

  const required = chores.filter(c => c.type === 'required')
  const extras = chores.filter(c => c.type === 'extra')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Settings</h1>
        <p style={{ color: '#64748b', marginTop: '0.25rem', fontSize: '0.9rem' }}>Configure allowance, interest, chores, and categories</p>
      </div>

      {msg && (
        <div style={{ background: '#dcfce7', color: '#15803d', padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.875rem' }}>
          {msg}
        </div>
      )}

      {/* Financial settings */}
      <div className="card">
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.1rem', fontWeight: 700 }}>Financial Settings</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
          {[
            { key: 'default_allowance', label: 'Default Weekly Allowance ($)', suffix: '$', description: 'Given when all required chores are completed' },
            { key: 'interest_rate', label: 'Monthly Interest Rate (%)', suffix: '%', description: 'Applied on the 1st of every month' },
            { key: 'tithe_percentage', label: 'Tithe Percentage (%)', suffix: '%', description: 'Minimum tithe from each allowance (children can give more)' },
          ].map(({ key, label, description }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step={key === 'default_allowance' ? '1' : '0.1'}
                  value={settings[key as keyof typeof settings]}
                  onChange={e => setSettings(prev => ({ ...prev, [key]: e.target.value }))}
                />
                <button
                  className="btn-primary"
                  style={{ flexShrink: 0, padding: '0.5rem 1rem' }}
                  onClick={() => saveSetting(key, settings[key as keyof typeof settings])}
                  disabled={saving === key}
                >
                  {saving === key ? '...' : 'Save'}
                </button>
              </div>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>{description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Notification email */}
      <div className="card">
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>Admin Notification Email</h2>
        <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#64748b' }}>
          This is your real email address where you&apos;ll receive Saturday allowance reminders and withdrawal alerts.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', maxWidth: '480px' }}>
          <input
            className="input"
            type="email"
            placeholder="your.real@gmail.com"
            value={notifEmail}
            onChange={e => setNotifEmail(e.target.value)}
          />
          <button className="btn-primary" style={{ flexShrink: 0 }} onClick={saveNotifEmail} disabled={saving === 'notif'}>
            {saving === 'notif' ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Chore templates */}
      <div className="card">
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.1rem', fontWeight: 700 }}>Chore Templates</h2>

        {/* Required chores */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1d4ed8', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Part 1 — Required Chores
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {required.map(chore => (
              <div key={chore.id} style={{
                padding: '0.75rem 1rem',
                background: chore.active ? '#f8fafc' : '#f1f5f9',
                borderRadius: '0.75rem',
                opacity: chore.active ? 1 : 0.6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ flex: 1, fontWeight: 500, color: chore.active ? '#1e293b' : '#94a3b8' }}>{chore.name}</span>
                  <button
                    className="btn-secondary"
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.78rem' }}
                    onClick={() => toggleChore(chore.id, !chore.active)}
                  >
                    {chore.active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="btn-danger"
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.78rem' }}
                    onClick={() => deleteChore(chore.id)}
                  >
                    Delete
                  </button>
                </div>
                {children.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>Assign to:</span>
                    {children.map(child => (
                      <label key={child.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.8rem', color: '#475569' }}>
                        <input
                          type="checkbox"
                          checked={(assignments[child.id] ?? []).includes(chore.id)}
                          onChange={e => toggleAssignment(chore.id, child.id, e.target.checked)}
                          style={{ accentColor: '#1d4ed8', cursor: 'pointer' }}
                        />
                        {child.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Extra tasks */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#d97706', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Part 2 — Extra Reward Tasks
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {extras.map(chore => (
              <div key={chore.id} style={{
                padding: '0.75rem 1rem',
                background: chore.active ? '#fffbeb' : '#f1f5f9',
                borderRadius: '0.75rem',
                opacity: chore.active ? 1 : 0.6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ flex: 1, fontWeight: 500 }}>{chore.name}</span>
                  {editingReward[chore.id] !== undefined ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                      <span style={{ fontSize: '0.85rem', color: '#d97706', fontWeight: 700 }}>+$</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        autoFocus
                        value={editingReward[chore.id]}
                        onChange={e => setEditingReward(prev => ({ ...prev, [chore.id]: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveReward(chore.id)
                          if (e.key === 'Escape') setEditingReward(prev => { const n = { ...prev }; delete n[chore.id]; return n })
                        }}
                        onBlur={() => saveReward(chore.id)}
                        style={{ width: '70px', padding: '0.2rem 0.4rem', borderRadius: '0.5rem', border: '1.5px solid #fbbf24', fontSize: '0.85rem', fontWeight: 700, color: '#d97706', textAlign: 'center' }}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingReward(prev => ({ ...prev, [chore.id]: String(chore.reward_amount ?? 0) }))}
                      title="Click to edit reward"
                      style={{
                        background: '#fef3c7', color: '#d97706',
                        fontSize: '0.85rem', fontWeight: 700,
                        padding: '0.2rem 0.6rem', borderRadius: '999px',
                        border: '1.5px dashed #fbbf24', cursor: 'pointer',
                      }}
                    >+${chore.reward_amount}</button>
                  )}
                  <button
                    className="btn-secondary"
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.78rem' }}
                    onClick={() => toggleChore(chore.id, !chore.active)}
                  >
                    {chore.active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="btn-danger"
                    style={{ padding: '0.25rem 0.75rem', fontSize: '0.78rem' }}
                    onClick={() => deleteChore(chore.id)}
                  >
                    Delete
                  </button>
                </div>
                {children.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>Assign to:</span>
                    {children.map(child => (
                      <label key={child.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.8rem', color: '#475569' }}>
                        <input
                          type="checkbox"
                          checked={(assignments[child.id] ?? []).includes(chore.id)}
                          onChange={e => toggleAssignment(chore.id, child.id, e.target.checked)}
                          style={{ accentColor: '#d97706', cursor: 'pointer' }}
                        />
                        {child.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Add new chore */}
        <div style={{ background: '#f8fafc', borderRadius: '0.75rem', padding: '1rem' }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>Add New Chore / Task</div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select
              className="input"
              style={{ width: 'auto', minWidth: '160px' }}
              value={newChore.type}
              onChange={e => setNewChore(f => ({ ...f, type: e.target.value as 'required' | 'extra' }))}
            >
              <option value="required">Required Chore</option>
              <option value="extra">Extra Task</option>
            </select>
            <input
              className="input"
              style={{ flex: 1, minWidth: '200px' }}
              placeholder="Chore name..."
              value={newChore.name}
              onChange={e => setNewChore(f => ({ ...f, name: e.target.value }))}
            />
            {newChore.type === 'extra' && (
              <input
                className="input"
                style={{ width: '120px' }}
                type="number"
                min="0"
                placeholder="Reward $"
                value={newChore.reward_amount}
                onChange={e => setNewChore(f => ({ ...f, reward_amount: e.target.value }))}
              />
            )}
            <button className="btn-primary" onClick={addChore} disabled={saving === 'chore' || !newChore.name}>
              {saving === 'chore' ? 'Adding...' : '+ Add'}
            </button>
          </div>
        </div>
      </div>

      {/* Spending categories */}
      <div className="card">
        <h2 style={{ margin: '0 0 1rem', fontSize: '1.1rem', fontWeight: 700 }}>Spending Categories</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          {categories.map(cat => (
            <div key={cat.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              background: cat.active ? '#f0fdf4' : '#f1f5f9',
              border: `1px solid ${cat.active ? '#bbf7d0' : '#e2e8f0'}`,
              borderRadius: '999px',
              padding: '0.375rem 0.875rem',
              opacity: cat.active ? 1 : 0.6,
            }}>
              <span style={{ fontWeight: 500, fontSize: '0.875rem', color: cat.active ? '#15803d' : '#94a3b8' }}>{cat.name}</span>
              <button
                onClick={() => toggleCategory(cat.id, !cat.active)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '0.8rem', padding: 0 }}
              >
                {cat.active ? '●' : '○'}
              </button>
              <button
                onClick={() => deleteCategory(cat.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '0.85rem', padding: 0 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', maxWidth: '400px' }}>
          <input
            className="input"
            placeholder="New category name..."
            value={newCategory}
            onChange={e => setNewCategory(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCategory()}
          />
          <button className="btn-primary" style={{ flexShrink: 0 }} onClick={addCategory}>Add</button>
        </div>
      </div>

      {/* Change Password */}
      <div className="card">
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>🔑 Change Password</h2>
        <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#64748b' }}>
          Update the password for your admin account.
        </p>
        {pwMsg && (
          <div style={{
            background: pwMsgOk ? '#dcfce7' : '#fee2e2',
            color: pwMsgOk ? '#15803d' : '#991b1b',
            padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.875rem', marginBottom: '1rem',
          }}>
            {pwMsg}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '360px' }}>
          <div>
            <label className="label">New Password</label>
            <input
              className="input"
              type="password"
              placeholder="Min 6 characters"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Confirm Password</label>
            <input
              className="input"
              type="password"
              placeholder="Type it again"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
          </div>
          <button
            className="btn-primary"
            onClick={changePassword}
            disabled={saving === 'password' || newPassword.length < 6 || newPassword !== confirmPassword}
            style={{ alignSelf: 'flex-start' }}
          >
            {saving === 'password' ? 'Saving...' : 'Update Password'}
          </button>
        </div>
      </div>
    </div>
  )
}
