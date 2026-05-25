'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function SettingsPage() {
  const supabase = createClient()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgOk, setMsgOk] = useState(true)

  async function changePassword() {
    if (newPassword.length < 6) { setMsgOk(false); setMsg('Password must be at least 6 characters'); return }
    if (newPassword !== confirmPassword) { setMsgOk(false); setMsg('Passwords do not match'); return }
    setSaving(true)
    setMsg('')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) { setMsgOk(false); setMsg(error.message); setSaving(false); return }
    setMsgOk(true)
    setMsg('Password updated!')
    setNewPassword('')
    setConfirmPassword('')
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>Settings</h1>

      {msg && (
        <div style={{
          background: msgOk ? '#dcfce7' : '#fee2e2',
          color: msgOk ? '#15803d' : '#991b1b',
          padding: '0.75rem 1rem', borderRadius: '0.75rem', fontSize: '0.875rem',
        }}>
          {msg}
        </div>
      )}

      {/* Change Password */}
      <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.25rem' }}>🔑 Change Password</h2>
        <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.25rem' }}>
          Choose a new password for your account.
        </p>
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
            disabled={saving || newPassword.length < 6 || newPassword !== confirmPassword}
            style={{ alignSelf: 'flex-start' }}
          >
            {saving ? 'Saving...' : 'Update Password'}
          </button>
        </div>
      </div>
    </div>
  )
}
