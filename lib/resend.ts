import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY ?? 're_placeholder')

export async function sendAllowanceReminder(to: string[], appUrl: string) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  await resend.emails.send({
    from: 'DadBank <noreply@dadbank.app>',
    to,
    subject: `🏦 DadBank — Time to review allowances (${today})`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem;">
        <div style="text-align: center; margin-bottom: 2rem;">
          <div style="font-size: 3rem;">🏦</div>
          <h1 style="color: #16a34a; margin: 0.5rem 0 0.25rem;">DadBank</h1>
          <p style="color: #64748b; margin: 0;">Family Allowance Reminder</p>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem;">
          <h2 style="margin: 0 0 0.75rem; color: #15803d;">It's allowance time!</h2>
          <p style="margin: 0; color: #374151; line-height: 1.6;">
            It's Saturday evening — time to review this week's chores and approve your children's allowances.
            Log in to DadBank to check the checklists and authorize payments.
          </p>
        </div>
        <div style="text-align: center; margin-bottom: 1.5rem;">
          <a href="${appUrl}/admin/checklist"
             style="display: inline-block; background: #16a34a; color: white; text-decoration: none;
                    font-weight: 600; padding: 0.875rem 2rem; border-radius: 0.75rem; font-size: 1rem;">
            Review Checklists →
          </a>
        </div>
        <p style="color: #94a3b8; font-size: 0.8rem; text-align: center; margin: 0;">
          DadBank — Building good money habits, one allowance at a time.
        </p>
      </div>
    `,
  })
}

export async function sendWithdrawalAlert(to: string[], childName: string, amount: number, category: string, reason: string, appUrl: string) {
  await resend.emails.send({
    from: 'DadBank <noreply@dadbank.app>',
    to,
    subject: `🏦 DadBank — ${childName} wants to spend $${Math.ceil(amount)}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem;">
        <div style="text-align: center; margin-bottom: 2rem;">
          <div style="font-size: 3rem;">🏦</div>
          <h1 style="color: #16a34a; margin: 0.5rem 0 0.25rem;">DadBank</h1>
        </div>
        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem;">
          <h2 style="margin: 0 0 0.75rem; color: #c2410c;">Withdrawal Request</h2>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 0.375rem 0; color: #64748b; width: 100px;">Child</td><td style="font-weight: 600;">${childName}</td></tr>
            <tr><td style="padding: 0.375rem 0; color: #64748b;">Amount</td><td style="font-weight: 700; color: #dc2626; font-size: 1.25rem;">$${Math.ceil(amount)}</td></tr>
            <tr><td style="padding: 0.375rem 0; color: #64748b;">Category</td><td>${category}</td></tr>
            <tr><td style="padding: 0.375rem 0; color: #64748b;">Reason</td><td>${reason}</td></tr>
          </table>
        </div>
        <div style="text-align: center; margin-bottom: 1.5rem;">
          <a href="${appUrl}/admin/withdrawals"
             style="display: inline-block; background: #16a34a; color: white; text-decoration: none;
                    font-weight: 600; padding: 0.875rem 2rem; border-radius: 0.75rem; font-size: 1rem;">
            Approve or Deny →
          </a>
        </div>
      </div>
    `,
  })
}
