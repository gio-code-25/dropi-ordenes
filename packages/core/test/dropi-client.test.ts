import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DropiClient, generatePKCE, buildAuthorizeUrl, type OAuthConfig, type TokenStore, type OAuthTokens } from '../src/dropi-client'

const CONFIG: OAuthConfig = {
  clientId: 'test-client-id',
  redirectUri: 'http://localhost:3000/callback',
  authorizeUrl: 'https://oauth.dropi.co/oauth/authorize',
  tokenUrl: 'https://integrations.dropi.co/oauth/token',
  mcpUrl: 'https://mcp.dropi.co/mcp',
}

function makeStore(initial: OAuthTokens | null = null): TokenStore & { saved: OAuthTokens | null; disconnected: boolean } {
  return {
    saved: initial,
    disconnected: false,
    async load() { return this.saved },
    async save(t) { this.saved = t },
    async markDisconnected() { this.disconnected = true },
  }
}

describe('PKCE', () => {
  it('generates verifier and challenge', () => {
    const pkce = generatePKCE()
    expect(pkce.verifier).toBeTruthy()
    expect(pkce.challenge).toBeTruthy()
    expect(pkce.verifier).not.toBe(pkce.challenge)
  })

  it('generates different values each time', () => {
    const a = generatePKCE()
    const b = generatePKCE()
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('buildAuthorizeUrl', () => {
  it('builds correct URL with all params', () => {
    const pkce = { verifier: 'v', challenge: 'c' }
    const url = buildAuthorizeUrl(CONFIG, pkce, 'mystate')
    expect(url).toContain('https://oauth.dropi.co/oauth/authorize?')
    expect(url).toContain('client_id=test-client-id')
    expect(url).toContain('code_challenge=c')
    expect(url).toContain('code_challenge_method=S256')
    expect(url).toContain('scope=mcp')
    expect(url).toContain('state=mystate')
    expect(url).toContain('redirect_uri=')
  })

  it('omits state when not provided', () => {
    const pkce = { verifier: 'v', challenge: 'c' }
    const url = buildAuthorizeUrl(CONFIG, pkce)
    expect(url).not.toContain('state=')
  })
})

describe('DropiClient', () => {
  let store: ReturnType<typeof makeStore>
  let client: DropiClient

  beforeEach(() => {
    store = makeStore({
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: new Date(Date.now() + 3600_000),
    })
    client = new DropiClient(CONFIG, store)
    vi.restoreAllMocks()
  })

  describe('exchangeCode', () => {
    it('exchanges code for tokens and saves them', async () => {
      const mockResponse = {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      )

      const tokens = await client.exchangeCode('auth-code', 'verifier')
      expect(tokens.accessToken).toBe('new-access')
      expect(tokens.refreshToken).toBe('new-refresh')
      expect(tokens.expiresAt).toBeInstanceOf(Date)
      expect(store.saved?.accessToken).toBe('new-access')
    })

    it('throws on failed exchange', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('bad request', { status: 400 }),
      )
      await expect(client.exchangeCode('bad', 'v')).rejects.toThrow('Token exchange failed')
    })
  })

  describe('listOrders', () => {
    it('calls MCP and validates response', async () => {
      const mcpResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                orders: [
                  {
                    order_id: 12345,
                    status: 'ENTREGADO',
                    customer_name: 'Juan',
                    customer_phone: '5551234567',
                    city: 'CDMX',
                    total: 499,
                    currency: 'MXN',
                    created_at: '2026-10-01',
                  },
                ],
              }),
            },
          ],
        },
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mcpResponse), { status: 200 }),
      )

      const orders = await client.listOrders({ from: '2026-09-01', until: '2026-10-22' })
      expect(orders).toHaveLength(1)
      expect(orders[0]!.order_id).toBe(12345)
      expect(orders[0]!.status).toBe('ENTREGADO')
    })

    it('throws on invalid MCP response shape', async () => {
      const mcpResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ wrong: 'shape' }) }],
        },
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mcpResponse), { status: 200 }),
      )

      await expect(client.listOrders({ from: '2026-09-01', until: '2026-10-22' })).rejects.toThrow('schema mismatch')
    })

    it('throws on MCP error response', async () => {
      const mcpResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid request' },
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mcpResponse), { status: 200 }),
      )

      await expect(client.listOrders({ from: '2026-09-01', until: '2026-10-22' })).rejects.toThrow('MCP error')
    })
  })

  describe('getOrder', () => {
    it('fetches a single order', async () => {
      const mcpResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                order_id: 99,
                status: 'EN TRANSITO',
                total: 350,
                currency: 'MXN',
                updated_at: '2026-10-20T10:00:00Z',
              }),
            },
          ],
        },
      }

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mcpResponse), { status: 200 }),
      )

      const order = await client.getOrder(99)
      expect(order.order_id).toBe(99)
      expect(order.updated_at).toBe('2026-10-20T10:00:00Z')
    })
  })

  describe('token refresh', () => {
    it('refreshes expired tokens before calling MCP', async () => {
      store.saved = {
        accessToken: 'expired',
        refreshToken: 'good-refresh',
        expiresAt: new Date(Date.now() - 1000),
      }
      client = new DropiClient(CONFIG, store)

      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      // First call: refresh token
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: 'fresh', refresh_token: 'fresh-refresh', expires_in: 3600 }),
          { status: 200 },
        ),
      )

      // Second call: MCP
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { content: [{ type: 'text', text: JSON.stringify({ orders: [] }) }] },
          }),
          { status: 200 },
        ),
      )

      const orders = await client.listOrders({ from: '2026-10-01', until: '2026-10-22' })
      expect(orders).toHaveLength(0)
      expect(store.saved?.accessToken).toBe('fresh')
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it('marks connection as disconnected when refresh fails', async () => {
      store.saved = {
        accessToken: 'expired',
        refreshToken: 'bad-refresh',
        expiresAt: new Date(Date.now() - 1000),
      }
      client = new DropiClient(CONFIG, store)

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('unauthorized', { status: 401 }),
      )

      await expect(client.listOrders({ from: '2026-10-01', until: '2026-10-22' })).rejects.toThrow('refresh failed')
      expect(store.disconnected).toBe(true)
    })
  })

  describe('listAllOrders pagination', () => {
    it('paginates until page is not full', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const makePage = (start: number, count: number) => ({
        jsonrpc: '2.0',
        id: 1,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                orders: Array.from({ length: count }, (_, i) => ({
                  order_id: start + i,
                  status: 'PENDIENTE',
                  currency: 'MXN',
                })),
              }),
            },
          ],
        },
      })

      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(makePage(0, 100)), { status: 200 }))
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(makePage(100, 50)), { status: 200 }))

      const all = await client.listAllOrders({ from: '2026-09-01', until: '2026-10-22' })
      expect(all).toHaveLength(150)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('not authenticated', () => {
    it('throws when no tokens available', async () => {
      const emptyStore = makeStore(null)
      const c = new DropiClient(CONFIG, emptyStore)
      await expect(c.listOrders({ from: '2026-10-01', until: '2026-10-22' })).rejects.toThrow('Not authenticated')
    })
  })
})
