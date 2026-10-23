import { describe, expect, it } from 'vitest'
import { toE164Mx } from '../src/normalize'

describe('toE164Mx', () => {
  it('adds the Mexico country code to 10-digit numbers from Dropi', () => {
    expect(toE164Mx('2221841539')).toBe('+522221841539')
  })

  it('accepts numbers that already include 52', () => {
    expect(toE164Mx('+52 222 184 1539')).toBe('+522221841539')
  })

  it('rejects anything else', () => {
    expect(toE164Mx('12345')).toBeNull()
    expect(toE164Mx('')).toBeNull()
  })
})
