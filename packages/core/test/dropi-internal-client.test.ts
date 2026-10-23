import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DropiInternalClient, JwtExpiredError, type JwtProvider } from '../src/dropi-internal-client'

function mockJwt(token = 'test-jwt-token'): JwtProvider {
  return { getToken: vi.fn().mockResolvedValue(token) }
}

function ordersResponse(orders: unknown[], isSuccess = true) {
  return new Response(JSON.stringify({ isSuccess, status: 200, count: orders.length, objects: orders }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function minimalOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 6234640,
    status: 'EN CAMINO A CIUDAD DE DESTINO',
    name: 'Miguel',
    surname: 'Angel',
    phone: '2221841539',
    dir: 'Calle 1',
    city: 'PUEBLA',
    state: 'PUEBLA',
    colonia: null,
    zip_code: '72228',
    notes: null,
    total_order: 959,
    rate_type: 'CON RECAUDO',
    type: 'FINAL_ORDER',
    shipping_guide: '59-77-605636',
    shipping_company: 'TIUI',
    created_at: '2026-10-20T21:52:27',
    user_id: 40243,
    supplier_id: 3243,
    warehouse_id: 153,
    distribution_company_id: 2,
    distribution_company: { id: 2, name: 'TIUI', color: null, is_veloces: false },
    orderdetails: [],
    servientrega_movements: [],
    shop_order_id: '189655566',
    shop_order_number: 1004,
    warranty: false,
    invoiced: false,
    guia_urls3: null,
    sticker: null,
    ...overrides,
  }
}

describe('DropiInternalClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(ordersResponse([]))
    vi.stubGlobal('fetch', fetchMock)
  })

  it('sends x-authorization header with Bearer token', async () => {
    const jwt = mockJwt('my-jwt')
    const client = new DropiInternalClient(jwt, { userId: 40243 })
    await client.listOrders({ from: '2026-10-01', until: '2026-10-22' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.headers).toHaveProperty('x-authorization', 'Bearer my-jwt')
    expect(String(url)).toContain('api.dropi.mx/api/orders/myorders/v2')
  })

  it('passes user_id, from, until as query params', async () => {
    const client = new DropiInternalClient(mockJwt(), { userId: 12345 })
    await client.listOrders({ from: '2026-10-01', until: '2026-10-22' })

    const url = new URL(String((fetchMock.mock.calls[0] as [string])[0]))
    expect(url.searchParams.get('user_id')).toBe('12345')
    expect(url.searchParams.get('from')).toBe('2026-10-01')
    expect(url.searchParams.get('until')).toBe('2026-10-22')
  })

  it('paginates with start param', async () => {
    const client = new DropiInternalClient(mockJwt(), { userId: 40243 })
    await client.listOrders({ from: '2026-10-01', until: '2026-10-22', start: 100, resultNumber: 50 })

    const url = new URL(String((fetchMock.mock.calls[0] as [string])[0]))
    expect(url.searchParams.get('start')).toBe('100')
    expect(url.searchParams.get('result_number')).toBe('50')
  })

  it('parses a valid order response', async () => {
    const order = minimalOrder()
    fetchMock.mockResolvedValueOnce(ordersResponse([order]))

    const client = new DropiInternalClient(mockJwt())
    const result = await client.listOrders({ from: '2026-10-01', until: '2026-10-22' })

    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe(6234640)
    expect(result[0]!.status).toBe('EN CAMINO A CIUDAD DE DESTINO')
    expect(result[0]!.shipping_company).toBe('TIUI')
  })

  it('includes servientrega_movements in the response', async () => {
    const movements = [
      { id: 1001, nom_mov: 'ENVÍO RECOLECTADO', created_at: '2026-10-21T16:07:23' },
      { id: 1002, nom_mov: 'EN CIUDAD DE ORIGEN', created_at: '2026-10-22T11:33:01' },
    ]
    fetchMock.mockResolvedValueOnce(ordersResponse([minimalOrder({ servientrega_movements: movements })]))

    const client = new DropiInternalClient(mockJwt())
    const result = await client.listOrders({ from: '2026-10-01', until: '2026-10-22' })

    expect(result[0]!.servientrega_movements).toHaveLength(2)
    expect(result[0]!.servientrega_movements![0]!.nom_mov).toBe('ENVÍO RECOLECTADO')
    expect(result[0]!.servientrega_movements![1]!.id).toBe(1002)
  })

  it('throws JwtExpiredError on 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

    const client = new DropiInternalClient(mockJwt())
    await expect(client.listOrders({ from: '2026-10-01', until: '2026-10-22' })).rejects.toThrow(JwtExpiredError)
  })

  it('throws JwtExpiredError on 403', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const client = new DropiInternalClient(mockJwt())
    await expect(client.listOrders({ from: '2026-10-01', until: '2026-10-22' })).rejects.toThrow(JwtExpiredError)
  })

  it('throws on non-200 responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Server Error', { status: 500 }))

    const client = new DropiInternalClient(mockJwt())
    await expect(client.listOrders({ from: '2026-10-01', until: '2026-10-22' })).rejects.toThrow('failed (500)')
  })

  it('throws on schema mismatch', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const client = new DropiInternalClient(mockJwt())
    await expect(client.listOrders({ from: '2026-10-01', until: '2026-10-22' })).rejects.toThrow('schema mismatch')
  })

  it('listAllOrders paginates until page is shorter than pageSize', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => minimalOrder({ id: i + 1 }))
    const page2 = [minimalOrder({ id: 101 })]

    fetchMock
      .mockResolvedValueOnce(ordersResponse(page1))
      .mockResolvedValueOnce(ordersResponse(page2))

    const client = new DropiInternalClient(mockJwt())
    const all = await client.listAllOrders({ from: '2026-10-01', until: '2026-10-22' })

    expect(all).toHaveLength(101)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const url2 = new URL(String((fetchMock.mock.calls[1] as [string])[0]))
    expect(url2.searchParams.get('start')).toBe('100')
  })

  it('includes orderdetails with product info', async () => {
    const details = [
      {
        product_id: 23469,
        product: { id: 23469, name: 'CERA', sale_price: 100 },
        variation_id: null,
        variation: null,
      },
    ]
    fetchMock.mockResolvedValueOnce(ordersResponse([minimalOrder({ orderdetails: details })]))

    const client = new DropiInternalClient(mockJwt())
    const result = await client.listOrders({ from: '2026-10-01', until: '2026-10-22' })

    expect(result[0]!.orderdetails![0]!.product!.name).toBe('CERA')
  })

  it('sets Referer and Origin headers for anti-bot', async () => {
    const client = new DropiInternalClient(mockJwt())
    await client.listOrders({ from: '2026-10-01', until: '2026-10-22' })

    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers.Referer).toBe('https://app.dropi.mx/')
    expect(headers.Origin).toBe('https://app.dropi.mx')
  })
})
