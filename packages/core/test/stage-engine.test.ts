import { describe, expect, it } from 'vitest'
import { applyStatus, type Notification, type StageState } from '../src/stage-engine'

function run(carrier: string, statuses: string[]) {
  let state: StageState | null = null
  const notifications: Notification[] = []
  const stages: string[] = []
  for (const status of statuses) {
    const update = applyStatus(state, carrier, status)
    state = update.state
    notifications.push(...update.notifications)
    if (update.statusChanged) stages.push(update.state.stage)
  }
  return { state, notifications, stages }
}

// Real Tiui timeline from the Dropi panel (30/07/2026 → 02/08/2026), duplicates included.
const TIUI_DELIVERED = [
  'PENDIENTE CONFIRMACION',
  'PENDIENTE',
  'GUIA_GENERADA',
  'ENVÍO RECOLECTADO',
  'ENVÍO RECOLECTADO',
  'PREPARADO PARA TRANSPORTADORA',
  'EN CEDIS TIUI CDMX RECOLECCIÓN',
  'PREPARANDO RUTA',
  'PREPARANDO RUTA',
  'EN RUTA DE ENTREGA',
  'ENTREGADO',
]

describe('stage engine — real Tiui delivery (PRD §6)', () => {
  it('sends exactly 3 customer messages and no owner alerts', () => {
    const { notifications } = run('TIUI', TIUI_DELIVERED)
    expect(notifications).toEqual(['cliente.en_transito', 'cliente.en_reparto', 'cliente.entregado'])
  })

  it('never shows the order going backwards', () => {
    const { stages } = run('TIUI', TIUI_DELIVERED)
    expect(stages).toEqual([
      'PENDIENTE',
      'PENDIENTE',
      'PREPARANDO',
      'EN_TRANSITO',
      'EN_TRANSITO', // PREPARADO PARA TRANSPORTADORA arrived late: ignored
      'EN_TRANSITO',
      'EN_TRANSITO',
      'EN_REPARTO',
      'ENTREGADO',
    ])
  })

  it('gives the same result if the late status is observed first (R16)', () => {
    const reordered = [...TIUI_DELIVERED]
    reordered.splice(3, 3, 'PREPARADO PARA TRANSPORTADORA', 'ENVÍO RECOLECTADO')
    const { notifications } = run('TIUI', reordered)
    expect(notifications).toEqual(['cliente.en_transito', 'cliente.en_reparto', 'cliente.entregado'])
  })

  it('ends in a final delivered state', () => {
    const { state } = run('TIUI', TIUI_DELIVERED)
    expect(state).toMatchObject({ stage: 'ENTREGADO', maxRank: 50 })
  })
})

describe('stage engine — exceptions', () => {
  it('novedad alerts customer and owner, recovery does not re-notify', () => {
    const { notifications, state } = run('TIUI', [
      'PENDIENTE',
      'ENVÍO RECOLECTADO',
      'EN RUTA DE ENTREGA',
      'INTENTO DE ENTREGA',
      'EN RUTA DE ENTREGA',
      'ENTREGADO',
    ])
    expect(notifications).toEqual([
      'cliente.en_transito',
      'cliente.en_reparto',
      'cliente.novedad',
      'dueno.novedad',
      'cliente.entregado',
    ])
    expect(state?.stage).toBe('ENTREGADO')
  })

  it('a second different novedad alerts the owner again but not the customer', () => {
    const { notifications } = run('TIUI', ['EN RUTA DE ENTREGA', 'INTENTO DE ENTREGA', 'ENVÍO REAGENDADO'])
    expect(notifications).toEqual(['cliente.novedad', 'dueno.novedad', 'dueno.novedad'])
  })

  it('after a novedad, a lower ranked status shows the highest stage reached', () => {
    const { state } = run('TIUI', ['EN RUTA DE ENTREGA', 'INTENTO DE ENTREGA', 'PREPARANDO RUTA'])
    expect(state?.stage).toBe('EN_REPARTO')
  })

  it('return flow alerts only the owner', () => {
    const { notifications } = run('TIUI', ['EN RUTA DE ENTREGA', 'PARA DEVOLUCIÓN', 'DEVUELTO'])
    expect(notifications).toEqual(['dueno.devolucion', 'dueno.devuelto'])
  })

  it('cancellation sends nothing', () => {
    const { notifications } = run('TIUI', ['PENDIENTE CONFIRMACION', 'CANCELADO'])
    expect(notifications).toEqual([])
  })

  it('each new unknown status alerts the owner', () => {
    const { notifications } = run('TIUI', ['PENDIENTE', 'ALGO NUEVO', 'OTRA COSA NUEVA'])
    expect(notifications).toEqual(['dueno.desconocido', 'dueno.desconocido'])
  })
})

describe('stage engine — first sight', () => {
  it('does not message the customer about an order already in progress', () => {
    const update = applyStatus(null, 'TIUI', 'EN RUTA DE ENTREGA')
    expect(update.notifications).toEqual([])
    expect(update.state).toEqual({ statusRaw: 'EN RUTA DE ENTREGA', stage: 'EN_REPARTO', maxRank: 40 })
  })

  it('still alerts the owner about an unknown status', () => {
    expect(applyStatus(null, 'TIUI', 'NUEVO ESTATUS').notifications).toEqual(['dueno.desconocido'])
  })

  it('an unchanged status is a no-op', () => {
    const first = applyStatus(null, 'TIUI', 'ENVÍO RECOLECTADO')
    const again = applyStatus(first.state, 'TIUI', 'ENVIO RECOLECTADO')
    expect(again).toMatchObject({ statusChanged: false, notifications: [] })
  })
})
