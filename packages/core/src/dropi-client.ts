import { createHash, randomBytes } from 'crypto'
import { z } from 'zod'
import {
  GetOrderResponseSchema,
  ListCarriersResponseSchema,
  ListOrdersResponseSchema,
  ListStatusesResponseSchema,
  type DropiOrder,
} from './dropi-schemas'

// ── Types ───────────────────────────────────────────────────

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date | null
}

export interface OAuthConfig {
  clientId: string
  redirectUri: string
  authorizeUrl: string
  tokenUrl: string
  mcpUrl: string
}

export interface TokenStore {
  load(): Promise<OAuthTokens | null>
  save(tokens: OAuthTokens): Promise<void>
  markDisconnected(): Promise<void>
}

export interface DropiClientLogger {
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
}

const noopLogger: DropiClientLogger = {
  info() {},
  warn() {},
  error() {},
}

// ── PKCE helpers ────────────────────────────────────────────

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function buildAuthorizeUrl(
  config: OAuthConfig,
  pkce: { verifier: string; challenge: string },
  state?: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'mcp',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    ...(state ? { state } : {}),
  })
  return `${config.authorizeUrl}?${params}`
}

// ── Client ──────────────────────────────────────────────────

export class DropiClient {
  private tokens: OAuthTokens | null = null
  private refreshing: Promise<void> | null = null

  constructor(
    private readonly config: OAuthConfig,
    private readonly store: TokenStore,
    private readonly logger: DropiClientLogger = noopLogger,
  ) {}

  // ── Token lifecycle ─────────────────────────────────────

  async exchangeCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: codeVerifier,
    })

    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Token exchange failed (${res.status}): ${text}`)
    }

    const data = await res.json()
    const tokens = this.parseTokenResponse(data)
    await this.store.save(tokens)
    this.tokens = tokens
    this.logger.info('OAuth tokens obtained')
    return tokens
  }

  private async refreshTokens(): Promise<void> {
    const current = this.tokens ?? (await this.store.load())
    if (!current?.refreshToken) {
      await this.store.markDisconnected()
      throw new Error('No refresh token available')
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: this.config.clientId,
    })

    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!res.ok) {
      this.logger.error('Token refresh failed', { status: res.status })
      await this.store.markDisconnected()
      throw new Error(`Token refresh failed (${res.status})`)
    }

    const data = await res.json()
    const tokens = this.parseTokenResponse(data)
    await this.store.save(tokens)
    this.tokens = tokens
    this.logger.info('OAuth tokens refreshed')
  }

  private parseTokenResponse(data: unknown): OAuthTokens {
    const d = data as Record<string, unknown>
    const accessToken = String(d.access_token ?? '')
    const refreshToken = String(d.refresh_token ?? '')
    if (!accessToken) throw new Error('Missing access_token in response')

    let expiresAt: Date | null = null
    if (typeof d.expires_in === 'number') {
      expiresAt = new Date(Date.now() + d.expires_in * 1000 - 60_000)
    }

    return { accessToken, refreshToken, expiresAt }
  }

  private async ensureTokens(): Promise<string> {
    if (!this.tokens) {
      this.tokens = await this.store.load()
    }
    if (!this.tokens) {
      throw new Error('Not authenticated — run OAuth flow first')
    }

    if (this.tokens.expiresAt && this.tokens.expiresAt <= new Date()) {
      if (!this.refreshing) {
        this.refreshing = this.refreshTokens().finally(() => {
          this.refreshing = null
        })
      }
      await this.refreshing
    }

    return this.tokens!.accessToken
  }

  // ── MCP call ────────────────────────────────────────────

  private async callMcp<T>(tool: string, args: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const token = await this.ensureTokens()

    const res = await fetch(this.config.mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
    })

    if (res.status === 401) {
      this.logger.warn('MCP returned 401, attempting refresh')
      await this.refreshTokens()
      return this.callMcp(tool, args, schema)
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`MCP call ${tool} failed (${res.status}): ${text}`)
    }

    const json = await res.json()

    if (json.error) {
      throw new Error(`MCP error in ${tool}: ${JSON.stringify(json.error)}`)
    }

    const content = json.result?.content
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error(`MCP ${tool}: empty content`)
    }

    const textBlock = content.find((c: { type: string }) => c.type === 'text')
    if (!textBlock?.text) {
      throw new Error(`MCP ${tool}: no text block in response`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(textBlock.text)
    } catch {
      throw new Error(`MCP ${tool}: invalid JSON in text block`)
    }

    const result = schema.safeParse(parsed)
    if (!result.success) {
      this.logger.error(`MCP ${tool}: schema validation failed`, {
        errors: result.error.issues,
      })
      throw new Error(`MCP ${tool}: response schema mismatch — ${result.error.issues.map((i) => i.message).join(', ')}`)
    }

    return result.data
  }

  // ── Public API ──────────────────────────────────────────

  async listOrders(params: {
    from: string
    until: string
    status?: string
    start?: number
    resultNumber?: number
    textToSearch?: string
    cityId?: number
  }): Promise<DropiOrder[]> {
    const args: Record<string, unknown> = {
      from: params.from,
      until: params.until,
      result_number: params.resultNumber ?? 100,
      start: params.start ?? 0,
    }
    if (params.status) args.status = params.status
    if (params.textToSearch) args.text_to_search = params.textToSearch
    if (params.cityId) args.city_id = params.cityId

    const data = await this.callMcp('list_orders', args, ListOrdersResponseSchema)
    return data.orders
  }

  async listAllOrders(params: {
    from: string
    until: string
    status?: string
  }): Promise<DropiOrder[]> {
    const all: DropiOrder[] = []
    let start = 0
    const pageSize = 100

    while (true) {
      const page = await this.listOrders({
        from: params.from,
        until: params.until,
        status: params.status,
        start,
        resultNumber: pageSize,
      })
      all.push(...page)
      if (page.length < pageSize) break
      start += pageSize
    }

    return all
  }

  async getOrder(orderId: number): Promise<DropiOrder> {
    return this.callMcp('get_order', { order_id: orderId }, GetOrderResponseSchema)
  }

  async listStatuses(): Promise<{ status: string; company?: string | null }[]> {
    const data = await this.callMcp('list_statuses', {}, ListStatusesResponseSchema)
    return data.statuses
  }

  async listCarriers(): Promise<{ name: string }[]> {
    const data = await this.callMcp('list_carriers', {}, ListCarriersResponseSchema)
    return data.carriers
  }
}
