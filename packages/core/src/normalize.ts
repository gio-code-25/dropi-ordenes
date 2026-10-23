export function normalizeStatus(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// "Quality-Post", "QUALITY POST" and "QualityPost" must resolve to the same carrier.
export function normalizeCarrier(raw: string): string {
  return normalizeStatus(raw).replace(/[^A-Z0-9]/g, '')
}

const MX_COUNTRY_CODE = '52'

export function toE164Mx(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+${MX_COUNTRY_CODE}${digits}`
  if (digits.length === 12 && digits.startsWith(MX_COUNTRY_CODE)) return `+${digits}`
  return null
}
