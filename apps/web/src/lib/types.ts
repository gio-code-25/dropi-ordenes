export interface Order {
  order_id: string
  status_raw: string
  stage: string
  customer_name: string | null
  phone_e164: string | null
  address: string | null
  city: string | null
  total: string | null
  currency: string
  shipping_company: string | null
  tracking_code: string | null
  items: unknown[] | null
  notes: string | null
  is_final: boolean
  dropi_created_at: string | null
  first_seen_at: string
  last_checked_at: string
}

export interface StatusHistoryEntry {
  id: string
  order_id: string
  prev_status: string | null
  new_status: string | null
  prev_stage: string | null
  new_stage: string | null
  source: string
  dropi_movement_id: string | null
  dropi_timestamp: string | null
  detected_at: string
}

export interface PollRun {
  id: string
  orders_read: number | null
  changes: number | null
  errors: unknown | null
  started_at: string
  finished_at: string | null
}

export const STAGE_LABELS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  CONFIRMADO: 'Confirmado',
  ALISTAMIENTO: 'Alistamiento',
  RECOLECTADO: 'Recolectado',
  EN_TRANSITO: 'En tránsito',
  EN_CIUDAD_DESTINO: 'En ciudad destino',
  EN_REPARTO: 'En reparto',
  ENTREGADO: 'Entregado',
  DEVOLUCION: 'Devolución',
  CANCELADO: 'Cancelado',
  DESCONOCIDO: 'Desconocido',
}

export const STAGE_COLORS: Record<string, string> = {
  PENDIENTE: 'bg-yellow-100 text-yellow-800',
  CONFIRMADO: 'bg-blue-100 text-blue-800',
  ALISTAMIENTO: 'bg-indigo-100 text-indigo-800',
  RECOLECTADO: 'bg-purple-100 text-purple-800',
  EN_TRANSITO: 'bg-cyan-100 text-cyan-800',
  EN_CIUDAD_DESTINO: 'bg-teal-100 text-teal-800',
  EN_REPARTO: 'bg-orange-100 text-orange-800',
  ENTREGADO: 'bg-green-100 text-green-800',
  DEVOLUCION: 'bg-red-100 text-red-800',
  CANCELADO: 'bg-gray-100 text-gray-800',
  DESCONOCIDO: 'bg-gray-100 text-gray-500',
}
