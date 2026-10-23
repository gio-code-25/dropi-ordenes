import { normalizeStatus } from './normalize'
import { STAGE_RANK, stageForRank, type Stage } from './stages'
import { resolveStatus, type ResolvedStatus } from './status-map'

export interface StageState {
  statusRaw: string
  stage: Stage
  maxRank: number
}

export type Notification =
  | 'cliente.en_transito'
  | 'cliente.en_reparto'
  | 'cliente.novedad'
  | 'cliente.entregado'
  | 'dueno.novedad'
  | 'dueno.devolucion'
  | 'dueno.devuelto'
  | 'dueno.incidencia'
  | 'dueno.desconocido'

export interface StatusUpdate {
  state: StageState
  resolved: ResolvedStatus
  statusChanged: boolean
  stageChanged: boolean
  notifications: Notification[]
}

const CUSTOMER_ON_ADVANCE: Partial<Record<Stage, Notification>> = {
  EN_TRANSITO: 'cliente.en_transito',
  EN_REPARTO: 'cliente.en_reparto',
  ENTREGADO: 'cliente.entregado',
}

const OWNER_ON_ENTER: Partial<Record<Stage, Notification>> = {
  NOVEDAD: 'dueno.novedad',
  DEVOLUCION: 'dueno.devolucion',
  DEVUELTO: 'dueno.devuelto',
  INCIDENCIA: 'dueno.incidencia',
  DESCONOCIDO: 'dueno.desconocido',
}

export function applyStatus(prev: StageState | null, carrier: string | null, statusRaw: string): StatusUpdate {
  const resolved = resolveStatus(carrier, statusRaw)

  if (prev && normalizeStatus(prev.statusRaw) === normalizeStatus(statusRaw)) {
    return { state: prev, resolved, statusChanged: false, stageChanged: false, notifications: [] }
  }

  const rank = STAGE_RANK[resolved.stage]
  const prevMax = prev?.maxRank ?? 0
  let stage: Stage = resolved.stage
  let maxRank = prevMax

  if (rank !== null) {
    if (rank >= prevMax) maxRank = rank
    // A late or manual status from an earlier step must not move the order backwards.
    else stage = stageForRank(prevMax) ?? resolved.stage
  }

  const state: StageState = { statusRaw, stage, maxRank }
  const stageChanged = prev?.stage !== stage

  // First sight of an order (bootstrap or polling gap): never message the customer about the past.
  if (!prev) {
    const notifications: Notification[] = resolved.stage === 'DESCONOCIDO' ? ['dueno.desconocido'] : []
    return { state, resolved, statusChanged: true, stageChanged, notifications }
  }

  const notifications: Notification[] = []
  if (rank !== null && rank > prevMax) {
    const customer = CUSTOMER_ON_ADVANCE[stage]
    if (customer) notifications.push(customer)
  }
  if (stage === 'NOVEDAD' && stageChanged) notifications.push('cliente.novedad')
  // Owner alerts fire on every new raw status inside an exception stage (e.g. a second different incident).
  const owner = OWNER_ON_ENTER[resolved.stage]
  if (owner && rank === null) notifications.push(owner)

  return { state, resolved, statusChanged: true, stageChanged, notifications }
}
