import pg from 'pg'

let pool: pg.Pool | null = null

export function getDb(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL env var required')
    pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 5 })
  }
  return pool
}
