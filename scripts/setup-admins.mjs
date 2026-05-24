// One-time script to create admin accounts
// Run with: node scripts/setup-admins.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://vkuturrbxmlsghibplxz.supabase.co'
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('Missing SERVICE_ROLE_KEY. Run as:')
  console.error('SERVICE_ROLE_KEY=your_key node scripts/setup-admins.mjs')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const admins = [
  { email: 'lambert@jz', password: 'lambert', name: 'Lambert', notifEmail: 'lambertchien@gmail.com' },
  { email: 'ivy@jz',     password: 'ivyivy',  name: 'Ivy',     notifEmail: 'hisivy@gmail.com' },
]

for (const admin of admins) {
  console.log(`Creating ${admin.email}...`)

  const { data, error } = await supabase.auth.admin.createUser({
    email: admin.email,
    password: admin.password,
    email_confirm: true,
  })

  if (error) {
    console.error(`  ✗ Auth error: ${error.message}`)
    continue
  }

  const userId = data.user.id
  console.log(`  ✓ Auth user created: ${userId}`)

  const { error: profileError } = await supabase.from('profiles').insert({
    id: userId,
    name: admin.name,
    role: 'admin',
    notification_email: admin.notifEmail || null,
  })

  if (profileError) {
    console.error(`  ✗ Profile error: ${profileError.message}`)
  } else {
    console.log(`  ✓ Profile created for ${admin.name}`)
  }
}

console.log('\nDone! You can now log in at http://localhost:3000/login')
console.log('lambert@jz / lambert')
console.log('ivy@jz     / ivyivy')
console.log('\nChange passwords in Supabase → Authentication → Users after setup.')
