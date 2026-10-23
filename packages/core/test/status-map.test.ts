import { describe, expect, it } from 'vitest'
import { listStatusRules, resolveStatus } from '../src/status-map'
import catalog from './fixtures/dropi-statuses.json'

const entries = Object.entries(catalog)
  .filter(([company]) => company !== '_source')
  .flatMap(([company, names]) => (names as string[]).map((name) => ({ company: company || null, name })))

describe('status map vs Dropi catalog', () => {
  it('fixture holds the full 225-status catalog', () => {
    expect(entries).toHaveLength(225)
  })

  it.each(entries)('$company / $name is classified', ({ company, name }) => {
    expect(resolveStatus(company, name).stage).not.toBe('DESCONOCIDO')
  })

  it('every carrier-specific rule exists in the catalog (no typos or invented statuses)', () => {
    const known = new Set(entries.map((e) => `${e.company ?? ''}|${e.name}`))
    const stray = listStatusRules().filter((r) => !known.has(`${r.carrier ?? ''}|${r.status}`))
    expect(stray).toEqual([])
  })
})

describe('resolveStatus', () => {
  it('matches carrier names as list_orders sends them', () => {
    expect(resolveStatus('TIUI', 'ENVÍO RECOLECTADO')).toMatchObject({ stage: 'EN_TRANSITO', matchedBy: 'carrier' })
    expect(resolveStatus('QUALITY POST', 'ENTREGA')).toMatchObject({ stage: 'ENTREGADO', matchedBy: 'carrier' })
  })

  it('ignores accents and spacing differences', () => {
    expect(resolveStatus('TIUI', 'envio  recolectado').stage).toBe('EN_TRANSITO')
  })

  it('falls back to generic Dropi statuses for any carrier', () => {
    expect(resolveStatus('TIUI', 'GUIA_GENERADA')).toMatchObject({ stage: 'PREPARANDO', matchedBy: 'generic' })
    expect(resolveStatus(null, 'PENDIENTE CONFIRMACION').stage).toBe('PENDIENTE')
  })

  it('same raw status can mean different things per carrier', () => {
    expect(resolveStatus('99Minutos', 'DEVOLUCION').stage).toBe('DEVUELTO')
    expect(resolveStatus('Quiken', 'DEVOLUCION').stage).toBe('DEVOLUCION')
  })

  it('unknown status is DESCONOCIDO, non-final, flagged for review', () => {
    expect(resolveStatus('TIUI', 'ESTATUS QUE NO EXISTE')).toEqual({
      stage: 'DESCONOCIDO',
      isFinal: false,
      needsReview: true,
      matchedBy: 'none',
    })
  })

  it('final flag follows the stage unless overridden', () => {
    expect(resolveStatus('TIUI', 'ENTREGADO').isFinal).toBe(true)
    expect(resolveStatus(null, 'INDEMNIZADA POR DROPI')).toMatchObject({ stage: 'INCIDENCIA', isFinal: true })
    expect(resolveStatus('TIUI', 'EN RUTA DE ENTREGA').isFinal).toBe(false)
  })
})
