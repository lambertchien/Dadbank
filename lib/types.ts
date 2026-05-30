export type Role = 'admin' | 'child'

export type TransactionType = 'allowance' | 'interest' | 'tithe' | 'withdrawal' | 'deposit' | 'adjustment'

export type WithdrawalStatus = 'pending' | 'approved' | 'denied'

export type ChecklistStatus = 'pending' | 'approved'

export interface Profile {
  id: string
  name: string
  email: string
  role: Role
  notification_email: string | null
  balance: number
  starting_balance: number
  created_at: string
}

export interface Transaction {
  id: string
  child_id: string
  amount: number
  type: TransactionType
  category: string | null
  description: string
  reference_id: string | null
  created_by: string | null
  created_at: string
  profiles?: { name: string }
}

export interface ChoreTemplate {
  id: string
  name: string
  type: 'required' | 'extra'
  reward_amount: number | null
  active: boolean
  created_at: string
}

export interface WeeklyChecklist {
  id: string
  child_id: string
  week_start: string
  status: ChecklistStatus
  base_amount: number
  extra_amount: number
  approved_by: string | null
  approved_at: string | null
  created_at: string
  profiles?: { name: string }
  checklist_items?: ChecklistItem[]
}

export interface ChecklistItem {
  id: string
  checklist_id: string
  chore_id: string
  checked: boolean
  count: number
  reward_earned: number
  chore_templates?: ChoreTemplate
}

export interface WithdrawalRequest {
  id: string
  child_id: string
  amount: number
  category: string
  reason: string
  status: WithdrawalStatus
  decided_by: string | null
  decided_at: string | null
  transaction_id: string | null
  created_at: string
  profiles?: { name: string }
}

export interface SpendingCategory {
  id: string
  name: string
  active: boolean
}

export interface AppSettings {
  default_allowance: number
  interest_rate: number
  tithe_percentage: number
}
