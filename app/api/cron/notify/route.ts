import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendAllowanceReminder } from '@/lib/resend'

// Runs every Saturday at 9pm — triggered by Vercel Cron
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Collect all admin notification emails
  const { data: admins } = await supabase
    .from('profiles')
    .select('notification_email')
    .eq('role', 'admin')
    .not('notification_email', 'is', null)

  const emails = (admins ?? [])
    .map(a => a.notification_email)
    .filter(Boolean) as string[]

  if (emails.length === 0) {
    return NextResponse.json({ message: 'No admin notification emails configured' })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://dadbank.vercel.app'
  await sendAllowanceReminder(emails, appUrl)

  return NextResponse.json({ ok: true, sent_to: emails })
}
