# Dropi Ordenes — Sistema Centralizado de Gestion de Pedidos

## Vision del proyecto

Software que gestiona automaticamente los pedidos de Dropi Mexico: confirma ordenes, detecta cambios de estatus, notifica a clientes por WhatsApp, y proporciona un panel de atencion al cliente. La IA maneja el flujo automatico, pero el usuario tiene un dashboard para supervisar y atender clientes manualmente cuando sea necesario.

---

## Que hace el sistema

### 1. Gestion automatica de ordenes
- Confirmar pedidos automaticamente (o con un click desde el panel)
- Cancelar pedidos desde el software (sin entrar a Dropi)
- Editar datos de ordenes (direccion, telefono, etc.)

### 2. Deteccion de cambios de estatus
- Polling periodico al MCP de Dropi (cada 5-10 minutos)
- Compara estatus actual vs ultimo registrado en base de datos
- Registra historial completo: cuando paso de PENDIENTE → CONFIRMADO → EN RUTA → ENTREGADO

### 3. Notificaciones WhatsApp automaticas
- Cuando un pedido cambia de estatus, envia mensaje al cliente
- Mensajes personalizados por tipo de cambio:
  - Confirmado → "Tu pedido ha sido confirmado, te llegara en X dias"
  - En ruta → "Tu pedido va en camino, tracking: XXX"
  - Entregado → "Tu pedido fue entregado, gracias por tu compra"
  - Devolucion → alerta al dueño, no al cliente
- Posibles proveedores: WhatsApp Business API, Twilio, o API no oficial

### 4. Panel de atencion al cliente
- Dashboard con todas las ordenes en tiempo real
- Filtros por estatus, fecha, ciudad, transportadora
- Detalle de cada orden con historial de cambios
- Chat/notas internas por orden
- Vista de metricas: ordenes por dia, tasa de entrega, devoluciones

### 5. IA como asistente
- Respuestas automaticas a clientes frecuentes ("donde esta mi pedido")
- Clasificacion de novedades (problema de direccion vs rechazo vs otro)
- Sugerencias de accion ante novedades

---

## Conocimiento tecnico de Dropi (aprendido del proyecto scraper)

### Como funciona Dropi por dentro
Dropi NO tiene API publica documentada. Todo se descubrio por ingenieria inversa:
1. Playwright abre Chrome headless → navega a `https://app.dropi.mx/auth/login`
2. Llena email + password → si tiene 2FA, resuelve TOTP automaticamente
3. Una vez en el dashboard, roba el JWT de `localStorage.getItem('DROPI_token')`
4. Con ese token llama directamente a la API interna de Dropi

### Login en Dropi (flujo exacto)
```
URL: https://app.dropi.mx/auth/login
1. Esperar selector #email
2. Escribir email con delay: 30ms entre teclas
3. Click en #password, escribir password con delay: 30ms
4. Click en boton submit / press Enter
5. Esperar: puede ir a /dashboard/ directo O mostrar pantalla 2FA
6. Si 2FA: buscar input[type="text"] o input[autocomplete="one-time-code"]
7. Generar TOTP, escribir codigo, press Enter
8. Esperar URL **/dashboard/**
```

### Anti-bot de Dropi (CRITICO)
Dropi detecto bots y bloquea el login si:
- User-Agent dice "HeadlessChrome" → usar UA real de Chrome
- `navigator.webdriver === true` → inyectar script que lo oculta

```javascript
// Configuracion obligatoria de Playwright para Dropi:
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
})
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 720 },
})
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
})
```

### TOTP: trucos aprendidos
- Si quedan <7 segundos en la ventana TOTP actual, esperar la siguiente ventana
- Reintentar hasta 3 veces con codigos frescos
- El TOTP de la cuenta de ventas usa SHA1, 6 digitos, ventana 30s

```javascript
// Verificar ventana TOTP antes de enviar
const segsEnVentana = 30 - (Math.floor(Date.now() / 1000) % 30)
if (segsEnVentana < 7) {
  await page.waitForTimeout((segsEnVentana + 1) * 1000)
}
```

### Funcion TOTP lista para copiar (NO inventar otra)
```javascript
import { createHmac } from 'crypto'

function generateTOTP(secret) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = secret.toUpperCase().replace(/=+$/, '')
  let bits = 0, value = 0
  const bytes = []
  for (const c of clean) {
    value = (value << 5) | chars.indexOf(c)
    bits += 5
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  const key = Buffer.from(bytes)
  const counter = Math.floor(Date.now() / 1000 / 30)
  const buf = Buffer.alloc(8)
  buf.writeBigInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset+1] << 16) | (hmac[offset+2] << 8) | hmac[offset+3]
  return String(code % 1000000).padStart(6, '0')
}

// Uso: generateTOTP(process.env.DROPI_TOTP_SECRET) → '482931' (6 digitos)
```

### API interna de Dropi (descubierta)

#### Catalogo de productos
```
POST https://api.dropi.mx/api/products/v4/index
Headers:
  x-authorization: Bearer <JWT_TOKEN>
  Content-Type: application/json
  Referer: https://app.dropi.mx/
  Origin: https://app.dropi.mx
Body:
{
  "pageSize": 60,
  "startData": 0,           // paginacion: 0, 60, 120...
  "privated_product": false,
  "userVerified": false,
  "favorite": false,
  "with_collection": true,
  "get_stock": true,
  "no_count": true,          // true en paginas >1 para eficiencia
  "search_type": "simple",
  "country": "MEXICO"
}
Response: { isSuccess: true, objects: [...productos], count: N }
```

#### Endpoints por descubrir para ordenes (si MCP no basta)
El panel de ordenes en `app.dropi.mx` usa endpoints similares. Si el MCP no cubre algo (ej: historial de cambios de estatus de una orden), hay que:
1. Abrir Chrome DevTools en app.dropi.mx
2. Ir a la seccion de ordenes
3. Inspeccionar Network → ver que endpoints llama
4. Replicar con el JWT robado

### Token JWT
- Se guarda en localStorage con key `DROPI_token`
- Viene con comillas: `"eyJhbG..."` → limpiar con `.replace(/^"|"$/g, '')`
- Header: `x-authorization: Bearer <token>` (NO `Authorization`, ojo)
- Expira despues de un tiempo indefinido, por eso el scraper hace login cada vez

### CDN de imagenes
```
Base: https://d39ru7awumhhs2.cloudfront.net/
Imagenes: https://d39ru7awumhhs2.cloudfront.net/mexico/products/{id}/{filename}
```

---

## Conexion con Dropi — MCP oficial

### Datos de conexion (ya probados y funcionando)
```
MCP Server:          https://mcp.dropi.co/mcp
OAuth Authorization: https://oauth.dropi.co/oauth/authorize
Token Endpoint:      https://integrations.dropi.co/oauth/token
Client Registration: https://integrations.dropi.co/oauth/register
Client ID:           dropi-geo-test-479415a4
Redirect URI:        http://localhost:3000/callback
Auth Method:         none (public client, no secret)
Grant Types:         authorization_code, refresh_token
PKCE:                S256 (obligatorio)
Scope:               mcp
```

### Flujo de autenticacion
1. App genera code_verifier + code_challenge (PKCE S256)
2. Redirige al usuario a `https://oauth.dropi.co/oauth/authorize` con los params
3. Usuario hace login en Dropi (una sola vez)
4. Dropi redirige a callback con authorization code
5. App intercambia code por access_token + refresh_token
6. access_token se usa como Bearer en cada request al MCP
7. Cuando expira, se renueva automaticamente con refresh_token
8. **No se desconecta nunca** — cada llamada es HTTP independiente

### Herramientas MCP disponibles (confirmadas)
| Herramienta | Que hace |
|---|---|
| `list_orders` | Lista ordenes con filtros (estatus, fecha, ciudad, texto) |
| `get_order` | Detalle completo de una orden por ID |
| `create_order` | Crear orden nueva |
| `list_products` | Lista productos con stock y precios |
| `list_statuses` | 225 estatus de 8 transportadoras |
| `list_carriers` | Transportadoras disponibles |
| `list_departments` | Departamentos/estados |
| `search_cities` | Buscar ciudades |
| `list_categories` | Categorias de productos |
| `quote_shipping` | Cotizar envio |
| `get_customer_fingerprint_profile` | Perfil/historial del cliente |

### Transportadoras detectadas
99Minutos, Tiui, Quiken, Bigsmart, Veloces, Fedex, Coordi, Quality-Post

### Estructura real de datos del MCP (confirmada oct 2026)

#### Orden (list_orders / get_order)
Campos: order_id, status, customer_name, customer_phone, city, total (numero),
currency (MXN), payment_method, shipping_company, rate_type (CON RECAUDO),
created_at (ISO datetime), tracking_code

#### Producto (list_products)
Campos: id, sku, name, sale_price, suggested_price, stock, supplier_id,
categories (array strings), gallery (array con urlS3), variations (array)

#### Parametros utiles de list_orders
- status: "PENDIENTE CONFIRMACION", "ENTREGADO", "CANCELADO", etc.
- from / until: fechas ISO (YYYY-MM-DD)
- text_to_search: busqueda libre por order_id, nombre o tracking
- city_id: resolver con search_cities
- result_number: max 100 por pagina
- start: offset paginacion (0 = primera)

### Limitaciones del MCP (lo que NO puede hacer)
- **No da historial de cambios de estatus** — solo el estatus actual
- **No puede editar ordenes** — solo list/get/create
- **No tiene webhooks** — hay que hacer polling
- Para historial de estatus: usar Playwright → entrar a app.dropi.mx → abrir orden → scrapeear timeline

---

## Infraestructura existente (compartida con el scraper)

### Servidor Oracle Cloud
```
SSH: ssh -i ~/.ssh/oracle_rsa ubuntu@160.34.222.103
Node: /home/ubuntu/.nvm/versions/node/v20.20.2/bin/
PM2: proceso separado del scraper (ej: dropi-ordenes)
```

### Supabase (misma instancia, tablas SEPARADAS)
```
URL: https://yfioxffdgtgxqgufbkbe.supabase.co
```
Tablas nuevas (no tocar products ni stock_snapshots del scraper):
- `orders` — ordenes sincronizadas desde Dropi
- `order_status_history` — historial de cada cambio de estatus
- `whatsapp_messages` — log de mensajes enviados
- `customers` — datos de clientes
- `settings` — configuracion del sistema

### Dominio
- DuckDNS: mi-nube-geo.duckdns.org (compartido, otro puerto)

---

## Pendientes criticos

- [x] **TOTP Secret de cuenta central** — obtenido, vive en `.env.local` (rotarlo: estuvo en texto plano aqui)
- [ ] **Repo GitHub** — crear dropi-ordenes en GitHub
- [ ] **Supabase** — crear proyecto NUEVO, separado del scraper

---

## Producto y decisiones

**El PRD en `docs/PRD.md` es la fuente de verdad** (fases, restricciones del MCP, modelo de etapas, datos, decisiones abiertas). Leerlo antes de construir cualquier feature.

Decidido (2026-10-23):
- Monorepo TypeScript con npm workspaces: `apps/web` (Next.js), `apps/worker` (polling + colas), `packages/core` (logica pura)
- Supabase (proyecto nuevo) + pg-boss como cola. Sin Redis
- Hosting: VPS Hetzner (Docker/Coolify). No Oracle, no Vercel
- WhatsApp: Meta Cloud API directo (cuenta verificada)
- v1 solo usa el MCP. Sin Playwright ni scraping. Confirmar/cancelar/editar se hace en Dropi
- Fase 0 (validador de estatus) va antes que cualquier mensajeria

Pruebas: `npm test` (Vitest). Tipos: `npm run typecheck`.

---

## Relacion con otros proyectos

| Proyecto | Proposito | Conexion |
|---|---|---|
| **SCRAPER DROPI** (dropi-stock-tracker) | Trackea catalogo/stock/ventas | Comparte Supabase y Oracle. NO se toca |
| **Dropi Ordenes** (este proyecto) | Gestiona pedidos + WhatsApp | Usa MCP oficial, tablas separadas |

**REGLA:** Nunca modificar tablas `products` ni `stock_snapshots` desde este proyecto. Son del scraper.

---

## Cuenta Dropi (cuenta central de ventas)
- **Email:** geovany3758@gmail.com
- **Password y TOTP:** solo en `.env.local` (nunca en archivos versionados)
- **TOTP Issuer:** Dropi-MX-DROP
- **MCP OAuth:** ya registrado (client_id: dropi-geo-test-479415a4)

### Variables de entorno
Plantilla en `.env.example`; valores reales en `.env.local` (ignorado por git).

### Cuenta scraper (NO usar en este proyecto)
- **Email:** hernareneg669@gmail.com
- **Uso:** Solo para el proyecto SCRAPER DROPI (catalogo/stock)

## GitHub
- **Usuario:** gio-code-25
- **Repo:** por crear (dropi-ordenes)

---

## Comandos rapidos

### Deploy a Oracle (cuando se defina el proyecto)
```bash
# Se definira cuando se elija la arquitectura
```

### Desarrollo local
```bash
# Se definira cuando se elija el stack
```
