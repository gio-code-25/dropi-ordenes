import { createHmac } from 'crypto'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { JwtProvider } from '@dropi-ordenes/core'

interface LoginCredentials {
  email: string
  password: string
  totpSecret: string
}

interface JwtProviderLogger {
  info(msg: string): void
  error(msg: string, data?: unknown): void
}

function generateTOTP(secret: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = secret.toUpperCase().replace(/=+$/, '')
  let bits = 0,
    value = 0
  const bytes: number[] = []
  for (const c of clean) {
    value = (value << 5) | chars.indexOf(c)
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  const key = Buffer.from(bytes)
  const counter = Math.floor(Date.now() / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeBigInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1]! & 0xf
  const code =
    ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!
  return String(code % 1000000).padStart(6, '0')
}

export class PlaywrightJwtProvider implements JwtProvider {
  private cachedToken: string | null = null
  private tokenObtainedAt: number = 0
  private refreshing: Promise<string> | null = null

  // Refresh JWT every 4 hours (conservative — Dropi JWT expiry is unknown)
  private readonly maxAgeMs = 4 * 60 * 60 * 1000

  constructor(
    private readonly credentials: LoginCredentials,
    private readonly logger: JwtProviderLogger,
  ) {}

  async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() - this.tokenObtainedAt < this.maxAgeMs) {
      return this.cachedToken
    }

    if (!this.refreshing) {
      this.refreshing = this.login().finally(() => {
        this.refreshing = null
      })
    }

    return this.refreshing
  }

  private async login(): Promise<string> {
    this.logger.info('Starting Dropi login via Playwright...')

    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
    })

    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
      })

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      const page = context.pages()[0] ?? (await context.newPage())

      await page.goto('https://app.dropi.mx/auth/login', { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('#email', { timeout: 15000 })

      // Fill credentials
      await page.locator('#email').fill('')
      await page.locator('#email').type(this.credentials.email, { delay: 30 })
      await page.locator('#password').click()
      await page.locator('#password').type(this.credentials.password, { delay: 30 })
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(3000)

      // Check for 2FA
      if (!page.url().includes('/dashboard')) {
        const totpInput = page.locator('input[type="text"], input[autocomplete="one-time-code"]').first()
        await totpInput.waitFor({ state: 'visible', timeout: 10000 })

        // Wait for good TOTP window
        const secsLeft = 30 - (Math.floor(Date.now() / 1000) % 30)
        if (secsLeft < 7) {
          await page.waitForTimeout((secsLeft + 1) * 1000)
        }

        const code = generateTOTP(this.credentials.totpSecret)
        await totpInput.fill('')
        await totpInput.type(code, { delay: 50 })
        await page.keyboard.press('Enter')
        await page.waitForURL('**/dashboard/**', { timeout: 15000 })
      }

      await page.waitForTimeout(2000)

      // Extract JWT from localStorage
      const rawToken = await page.evaluate(() => localStorage.getItem('DROPI_token'))
      if (!rawToken) {
        throw new Error('No DROPI_token found in localStorage after login')
      }

      const token = rawToken.replace(/^"|"$/g, '')
      this.cachedToken = token
      this.tokenObtainedAt = Date.now()
      this.logger.info('JWT obtained successfully')

      await context.close()
      return token
    } finally {
      await browser.close()
    }
  }
}
