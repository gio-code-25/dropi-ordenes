export const STAGES = [
  'PENDIENTE',
  'PREPARANDO',
  'EN_TRANSITO',
  'EN_REPARTO',
  'ENTREGADO',
  'NOVEDAD',
  'DEVOLUCION',
  'DEVUELTO',
  'CANCELADO',
  'INCIDENCIA',
  'DESCONOCIDO',
] as const

export type Stage = (typeof STAGES)[number]

// Stages without a rank are exceptions: they always apply, regardless of progress.
export const STAGE_RANK: Record<Stage, number | null> = {
  PENDIENTE: 10,
  PREPARANDO: 20,
  EN_TRANSITO: 30,
  EN_REPARTO: 40,
  ENTREGADO: 50,
  NOVEDAD: null,
  DEVOLUCION: null,
  DEVUELTO: null,
  CANCELADO: null,
  INCIDENCIA: null,
  DESCONOCIDO: null,
}

export const DEFAULT_FINAL_STAGES: ReadonlySet<Stage> = new Set(['ENTREGADO', 'DEVUELTO', 'CANCELADO'])

const STAGE_BY_RANK = new Map<number, Stage>(
  STAGES.flatMap((s) => {
    const rank = STAGE_RANK[s]
    return rank === null ? [] : [[rank, s] as const]
  }),
)

export function stageForRank(rank: number): Stage | undefined {
  return STAGE_BY_RANK.get(rank)
}
