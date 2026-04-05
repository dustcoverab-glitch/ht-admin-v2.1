import type { Customer } from '@/types'

export const SERVICE_STEPS: Record<string, { id: number; label: string }[]> = {
  stentvatt: [
    { id: 0, label: 'Ej påbörjad' },
    { id: 1, label: 'Hembesök' },
    { id: 2, label: 'Provtvätt' },
    { id: 3, label: 'Offert' },
    { id: 4, label: 'Stentvätt' },
    { id: 5, label: 'Impregnering' },
    { id: 6, label: 'Fogsand' },
  ],
  stentvatt_no_fogsand: [
    { id: 0, label: 'Ej påbörjad' },
    { id: 1, label: 'Hembesök' },
    { id: 2, label: 'Provtvätt' },
    { id: 3, label: 'Offert' },
    { id: 4, label: 'Stentvätt' },
    { id: 5, label: 'Impregnering' },
  ],
  altantvatt: [
    { id: 0, label: 'Ej påbörjad' },
    { id: 1, label: 'Hembesök' },
    { id: 2, label: 'Provtvätt' },
    { id: 3, label: 'Offert' },
    { id: 4, label: 'Altantvätt' },
    { id: 5, label: 'Efterbehandling' },
  ],
  asfaltstvatt: [
    { id: 0, label: 'Ej påbörjad' },
    { id: 1, label: 'Hembesök' },
    { id: 2, label: 'Provtvätt' },
    { id: 3, label: 'Offert' },
    { id: 4, label: 'Asfaltstvätt' },
  ],
}

export const SERVICE_LABELS: Record<string, string> = {
  stentvatt: 'Stentvätt',
  altantvatt: 'Altantvätt',
  asfaltstvatt: 'Asfaltstvätt',
}

export function getStepsForService(service: string, includeFogsand = false) {
  if (service === 'stentvatt') {
    return includeFogsand ? SERVICE_STEPS.stentvatt : SERVICE_STEPS.stentvatt_no_fogsand
  }
  return SERVICE_STEPS[service] || []
}

export function formatDate(dateStr: string) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('sv-SE', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

export function formatCurrency(amount: number) {
  return amount.toLocaleString('sv-SE') + ' kr'
}
