import type pg from 'pg'
import type { TokenStore, OAuthTokens } from '@dropi-ordenes/core'

const ENCRYPT_KEY = process.env.TOKEN_ENCRYPT_KEY ?? 'dropi-ordenes-dev-key'

export class DbTokenStore implements TokenStore {
  constructor(
    private readonly db: pg.Pool,
    private readonly tenantId: string,
  ) {}

  async load(): Promise<OAuthTokens | null> {
    const { rows } = await this.db.query(
      `SELECT
        pgp_sym_decrypt(access_token::bytea, $2) as access_token,
        pgp_sym_decrypt(refresh_token::bytea, $2) as refresh_token,
        expires_at
      FROM dropi_connections
      WHERE tenant_id = $1 AND status = 'ok'
      LIMIT 1`,
      [this.tenantId, ENCRYPT_KEY],
    )

    if (rows.length === 0) return null

    return {
      accessToken: rows[0].access_token,
      refreshToken: rows[0].refresh_token,
      expiresAt: rows[0].expires_at ? new Date(rows[0].expires_at) : null,
    }
  }

  async save(tokens: OAuthTokens): Promise<void> {
    await this.db.query(
      `INSERT INTO dropi_connections (tenant_id, access_token, refresh_token, expires_at, status, updated_at)
      VALUES ($1, pgp_sym_encrypt($2, $5), pgp_sym_encrypt($3, $5), $4, 'ok', now())
      ON CONFLICT (tenant_id)
      DO UPDATE SET
        access_token = pgp_sym_encrypt($2, $5),
        refresh_token = pgp_sym_encrypt($3, $5),
        expires_at = $4,
        status = 'ok',
        updated_at = now()`,
      [this.tenantId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt, ENCRYPT_KEY],
    )
  }

  async markDisconnected(): Promise<void> {
    await this.db.query(
      `UPDATE dropi_connections SET status = 'desconectada', updated_at = now() WHERE tenant_id = $1`,
      [this.tenantId],
    )
  }
}
