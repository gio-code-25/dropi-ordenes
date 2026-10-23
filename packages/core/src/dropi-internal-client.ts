import { z } from 'zod'
import {
  InternalListResponseSchema,
  StatusByCountryResponseSchema,
  type InternalOrder,
} from './dropi-internal-schemas'

export interface JwtProvider {
  getToken(): Promise<string>
}

export interface InternalClientConfig {
  baseUrl: string
  userId: number
}

const DEFAULT_CONFIG: InternalClientConfig = {
  baseUrl: 'https://api.dropi.mx/api',
  userId: 40243,
}

export interface InternalClientLogger {
  info(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  error(msg: string, data?: Record<string, unknown>): void
}

const noopLogger: InternalClientLogger = { info() {}, warn() {}, error() {} }

export class DropiInternalClient {
  private readonly config: InternalClientConfig
  private readonly logger: InternalClientLogger

  constructor(
    private readonly jwt: JwtProvider,
    config?: Partial<InternalClientConfig>,
    logger?: InternalClientLogger,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.logger = logger ?? noopLogger
  }

  private async request<T>(path: string, schema: z.ZodType<T>, params?: URLSearchParams): Promise<T> {
    const token = await this.jwt.getToken()
    const url = params ? `${this.config.baseUrl}${path}?${params}` : `${this.config.baseUrl}${path}`

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-authorization': `Bearer ${token}`,
        Accept: 'application/json',
        Referer: 'https://app.dropi.mx/',
        Origin: 'https://app.dropi.mx',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    })

    if (res.status === 401 || res.status === 403) {
      throw new JwtExpiredError(`API returned ${res.status} — JWT likely expired`)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Dropi API ${path} failed (${res.status}): ${text.slice(0, 200)}`)
    }

    const json: unknown = await res.json()
    const result = schema.safeParse(json)
    if (!result.success) {
      this.logger.error(`Schema validation failed for ${path}`, {
        errors: result.error.issues.slice(0, 5),
      })
      throw new Error(`Dropi API ${path}: response schema mismatch`)
    }

    return result.data
  }

  async listOrders(params: {
    from: string
    until: string
    status?: string
    start?: number
    resultNumber?: number
  }): Promise<InternalOrder[]> {
    const qs = new URLSearchParams({
      exportAs: 'orderByRow',
      orderBy: 'id',
      orderDirection: 'desc',
      result_number: String(params.resultNumber ?? 100),
      start: String(params.start ?? 0),
      textToSearch: '',
      status: params.status ?? 'null',
      supplier_id: 'false',
      user_id: String(this.config.userId),
      from: params.from,
      until: params.until,
      filter_product: 'undefined',
      haveIncidenceProcesamiento: 'false',
      tag_id: '',
      warranty: 'false',
      seller: 'null',
      filter_date_by: 'FECHA DE CREADO',
      invoiced: 'null',
    })

    const data = await this.request('/orders/myorders/v2', InternalListResponseSchema, qs)

    if (!data.isSuccess) {
      throw new Error('Dropi API returned isSuccess: false')
    }

    return data.objects
  }

  async listAllOrders(params: {
    from: string
    until: string
    status?: string
  }): Promise<InternalOrder[]> {
    const all: InternalOrder[] = []
    let start = 0
    const pageSize = 100

    while (true) {
      const page = await this.listOrders({
        ...params,
        start,
        resultNumber: pageSize,
      })
      all.push(...page)
      this.logger.info(`Fetched page at offset ${start}: ${page.length} orders`)
      if (page.length < pageSize) break
      start += pageSize
    }

    return all
  }

  async listStatuses(): Promise<{ name: string; id: number }[]> {
    const data = await this.request(
      '/helpers/getStatusesByCountry',
      StatusByCountryResponseSchema,
      new URLSearchParams({ country: '' }),
    )
    return data.objects
  }
}

export class JwtExpiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JwtExpiredError'
  }
}
