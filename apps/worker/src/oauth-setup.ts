import { createServer } from 'http'
import { generatePKCE, buildAuthorizeUrl, DropiClient, type OAuthConfig } from '@dropi-ordenes/core'
import { DbTokenStore } from './db-token-store.js'
import { getDb } from './db.js'

const config: OAuthConfig = {
  clientId: process.env.DROPI_OAUTH_CLIENT_ID!,
  redirectUri: process.env.DROPI_OAUTH_REDIRECT_URI ?? 'http://localhost:3000/callback',
  authorizeUrl: process.env.DROPI_OAUTH_AUTHORIZE_URL!,
  tokenUrl: process.env.DROPI_OAUTH_TOKEN_URL!,
  mcpUrl: process.env.DROPI_MCP_URL!,
}

const tenantId = process.env.TENANT_ID
if (!tenantId) {
  console.error('TENANT_ID env var required')
  process.exit(1)
}

const pkce = generatePKCE()
const authorizeUrl = buildAuthorizeUrl(config, pkce)

console.log('\n=== Dropi OAuth Setup ===')
console.log('Abre esta URL en tu navegador:\n')
console.log(authorizeUrl)
console.log('\nEsperando callback en http://localhost:3000/callback ...\n')

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost:3000')
  if (url.pathname !== '/callback') {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const code = url.searchParams.get('code')
  if (!code) {
    res.writeHead(400)
    res.end('Missing code parameter')
    return
  }

  try {
    const db = getDb()
    const store = new DbTokenStore(db, tenantId)
    const client = new DropiClient(config, store, {
      info: (msg) => console.log(`[info] ${msg}`),
      warn: (msg) => console.warn(`[warn] ${msg}`),
      error: (msg) => console.error(`[error] ${msg}`),
    })

    await client.exchangeCode(code, pkce.verifier)

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h1>Conexion exitosa</h1><p>Tokens guardados. Puedes cerrar esta ventana.</p>')
    console.log('Tokens guardados exitosamente.')

    await db.end()
    server.close()
    process.exit(0)
  } catch (err) {
    console.error('Error:', err)
    res.writeHead(500)
    res.end(`Error: ${err}`)
  }
})

server.listen(3000)
