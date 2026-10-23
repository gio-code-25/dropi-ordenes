import { createHmac } from 'crypto'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { InternalOrder, InternalListResponse, GuideHistoryResponse, OrderHistoryEntry } from '@dropi-ordenes/core'
import { InternalListResponseSchema, GuideHistoryResponseSchema, OrderDetailResponseSchema } from '@dropi-ordenes/core'

interface BrowserProxyCredentials {
  email: string
  password: string
  totpSecret: string
}

interface BrowserProxyConfig {
  userId: number
  headless?: boolean
}

interface BrowserProxyLogger {
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

export class BrowserApiProxy {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  private loggedIn = false

  constructor(
    private readonly credentials: BrowserProxyCredentials,
    private readonly config: BrowserProxyConfig,
    private readonly logger: BrowserProxyLogger,
  ) {}

  private async ensureLoggedIn(): Promise<Page> {
    if (this.page && this.loggedIn) {
      // Verify session is still alive
      const url = this.page.url()
      if (url.includes('app.dropi.mx/dashboard')) return this.page
      this.logger.info('Session expired, re-logging in...')
    }

    await this.close()
    return this.login()
  }

  private async login(): Promise<Page> {
    this.logger.info('Starting Dropi login via Playwright...')

    this.browser = await chromium.launch({
      headless: this.config.headless ?? true,
      args: ['--disable-blink-features=AutomationControlled'],
    })

    this.context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    })

    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    this.page = await this.context.newPage()
    await this.page.goto('https://app.dropi.mx/auth/login', { waitUntil: 'domcontentloaded' })
    await this.page.waitForSelector('#email', { timeout: 15000 })

    await this.page.locator('#email').fill('')
    await this.page.locator('#email').type(this.credentials.email, { delay: 30 })
    await this.page.locator('#password').click()
    await this.page.locator('#password').type(this.credentials.password, { delay: 30 })
    await this.page.waitForTimeout(500)
    await this.page.keyboard.press('Enter')
    await this.page.waitForTimeout(3000)

    if (!this.page.url().includes('/dashboard')) {
      const totpInput = this.page.locator('input[type="text"], input[autocomplete="one-time-code"]').first()
      await totpInput.waitFor({ state: 'visible', timeout: 10000 })

      const secsLeft = 30 - (Math.floor(Date.now() / 1000) % 30)
      if (secsLeft < 7) {
        await this.page.waitForTimeout((secsLeft + 1) * 1000)
      }

      const code = generateTOTP(this.credentials.totpSecret)
      await totpInput.fill('')
      await totpInput.type(code, { delay: 50 })
      await this.page.keyboard.press('Enter')
      await this.page.waitForURL('**/dashboard/**', { timeout: 15000 })
    }

    await this.page.waitForTimeout(2000)
    this.loggedIn = true
    this.logger.info('Logged in successfully')
    return this.page
  }

  async listAllOrders(params: { from: string; until: string; status?: string }): Promise<InternalOrder[]> {
    const page = await this.ensureLoggedIn()
    const userId = this.config.userId

    const rawResult = await page.evaluate(
      async ({ from, until, status, userId: uid }) => {
        const jwt = localStorage.getItem('DROPI_token')?.replace(/^"|"$/g, '')
        if (!jwt) throw new Error('No JWT in localStorage')

        const all: unknown[] = []
        let start = 0
        const pageSize = 100

        while (true) {
          const qs = new URLSearchParams({
            exportAs: 'orderByRow',
            orderBy: 'id',
            orderDirection: 'desc',
            result_number: String(pageSize),
            start: String(start),
            textToSearch: '',
            status: status ?? 'null',
            supplier_id: 'false',
            user_id: String(uid),
            from,
            until,
            filter_product: 'undefined',
            haveIncidenceProcesamiento: 'false',
            tag_id: '',
            warranty: 'false',
            seller: 'null',
            filter_date_by: 'FECHA DE CREADO',
            invoiced: 'null',
          })

          const res = await fetch(`https://api.dropi.mx/api/orders/myorders/v2?${qs}`, {
            method: 'GET',
            headers: {
              'x-authorization': `Bearer ${jwt}`,
              Accept: 'application/json',
            },
          })

          if (!res.ok) {
            throw new Error(`API returned ${res.status}: ${await res.text()}`)
          }

          const data = await res.json()
          if (!data.isSuccess) throw new Error('isSuccess: false')

          const objects = data.objects ?? []
          all.push(...objects)
          if (objects.length < pageSize) break
          start += pageSize
        }

        return { isSuccess: true, status: 200, count: all.length, objects: all }
      },
      { from: params.from, until: params.until, status: params.status, userId },
    )

    const parsed = InternalListResponseSchema.safeParse(rawResult)
    if (!parsed.success) {
      this.logger.error('Schema validation failed', { errors: parsed.error.issues.slice(0, 5) })
      throw new Error('API response schema mismatch')
    }

    return parsed.data.objects
  }

  async getGuideHistory(shippingGuide: string): Promise<GuideHistoryResponse['objects']> {
    const page = await this.ensureLoggedIn()

    const rawResult = await page.evaluate(
      async (guide: string) => {
        const jwt = localStorage.getItem('DROPI_token')?.replace(/^"|"$/g, '')
        if (!jwt) throw new Error('No JWT in localStorage')

        const res = await fetch(
          `https://api.dropi.mx/api/orders/consultarhistoricoguia?shipping_guide=${encodeURIComponent(guide)}`,
          {
            headers: {
              'x-authorization': `Bearer ${jwt}`,
              Accept: 'application/json',
            },
          },
        )

        if (!res.ok) throw new Error(`API returned ${res.status}`)
        return res.json()
      },
      shippingGuide,
    )

    const parsed = GuideHistoryResponseSchema.safeParse(rawResult)
    if (!parsed.success) {
      this.logger.error('Guide history schema validation failed', { errors: parsed.error.issues.slice(0, 5) })
      throw new Error('Guide history response schema mismatch')
    }

    return parsed.data.objects
  }

  async getOrderHistory(orderId: number): Promise<OrderHistoryEntry[]> {
    const page = await this.ensureLoggedIn()

    const rawResult = await page.evaluate(
      async (oid: number) => {
        const jwt = localStorage.getItem('DROPI_token')?.replace(/^"|"$/g, '')
        if (!jwt) throw new Error('No JWT in localStorage')

        const res = await fetch(
          `https://api.dropi.mx/api/orders/myorders/v2/${oid}?warranty=false`,
          {
            headers: {
              'x-authorization': `Bearer ${jwt}`,
              Accept: 'application/json',
            },
          },
        )

        if (!res.ok) throw new Error(`API returned ${res.status}`)
        return res.json()
      },
      orderId,
    )

    const parsed = OrderDetailResponseSchema.safeParse(rawResult)
    if (!parsed.success) {
      this.logger.error('Order detail schema validation failed', { errors: parsed.error.issues.slice(0, 5) })
      throw new Error('Order detail response schema mismatch')
    }

    return parsed.data.objects.history
  }

  async close(): Promise<void> {
    this.loggedIn = false
    this.page = null
    if (this.context) {
      await this.context.close().catch(() => {})
      this.context = null
    }
    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
  }
}
