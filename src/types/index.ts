export type ServiceType = 'stentvatt' | 'altantvatt' | 'asfaltstvatt'
export type CustomerStatus = 'new' | 'in_progress' | 'completed' | 'rejected'

export interface ServiceProgress {
  [service: string]: number
}

export interface Customer {
  id: string
  name: string
  phone: string
  email?: string
  address: string
  services: string | string[]
  service_kvm: string | Record<string, number>
  service_progress: string | Record<string, number>
  skipped_steps: string | Record<string, number[]>
  include_fogsand: boolean
  note?: string
  price_excl_vat?: number
  rejected?: boolean
  status: CustomerStatus
  created_at: string
  updated_at?: string
}

export interface ActivityLog {
  id: string
  customer_id: string
  log_type: 'comment' | 'status_change' | 'time_log' | 'image'
  content: string
  timestamp: string
  time_spent?: number
  image_url?: string
}

export interface MaintenanceContract {
  id: string
  name: string
  phone: string
  email?: string
  address: string
  amount?: number
  note?: string
  completed: boolean
  created_at: string
}
