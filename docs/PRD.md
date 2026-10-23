# PRD — Dropi Ordenes

> Version 0.1 · 2026-10-23 · Estado: borrador para desarrollo
> Fuente de verdad del producto. Las credenciales NUNCA van en este archivo (van en `.env.local`).

---

## 1. Resumen

Dropi Ordenes vigila automaticamente los pedidos de una cuenta de Dropi Mexico, registra cada cambio de estatus con su hora, avisa al cliente final por WhatsApp y da un panel para supervisar y atender. Empieza como herramienta propia y esta disenado para convertirse en SaaS multi-cliente.

**Problema:** en contra entrega (COD), el dueño revisa a mano el panel de Dropi, no se entera a tiempo de novedades y el cliente no recibe seguimiento, lo que sube las devoluciones.

**Principio rector:** primero datos correctos, despues automatizacion. Ninguna notificacion se construye hasta que la deteccion de estatus este validada.

---

## 2. Objetivos y no-objetivos

### Objetivos
1. Detectar el 100% de los cambios de estatus visibles con granularidad de 5 minutos.
2. Mantener un historial propio y confiable por orden (el MCP no lo da).
3. Notificar al cliente por WhatsApp en los momentos que importan, sin spam ni duplicados.
4. Alertar al dueño de novedades y devoluciones en minutos, no dias.
5. Base de datos multi-tenant desde el dia 1.

### No-objetivos (v1)
- Confirmar, cancelar o editar ordenes desde el software (el MCP no lo permite). Se hace en Dropi con un boton "Abrir en Dropi".
- Recuperar el historial de estatus anterior al arranque del sistema.
- Scraping de la interfaz de Dropi o de paginas de rastreo de transportadoras.
- App movil nativa.

---

## 3. Usuarios

| Usuario | Necesidad |
|---|---|
| **Dueño de tienda** (v1: tu) | Saber que pasa con cada pedido sin entrar a Dropi; enterarse de novedades a tiempo |
| **Agente de atencion** (futuro) | Ver el historial de una orden y responder al cliente rapido |
| **Cliente final** | Saber cuando llega su pedido y que hacer si hay un problema |

---

## 4. Restricciones conocidas (validadas contra el MCP real, 2026-10-23)

| # | Hecho | Consecuencia de diseño |
|---|---|---|
| R1 | El MCP solo devuelve el **estatus actual**, sin historial | El historial lo construimos nosotros con polling |
| R2 | `list_orders` **no** trae `updated_at`; `get_order` si | Detectar cambios comparando estatus contra el ultimo guardado |
| R3 | `list_orders` exige **ambas fechas** (`from` y `until`) si se filtra por fecha | El polling recorre una ventana de fechas (ver §7) |
| R4 | `list_orders` pagina con `start` + `result_number` (max 100) | Paginar hasta que `items.length < result_number` |
| R5 | 225 estatus, nombres crudos por transportadora (8 transportadoras) | Tabla de traduccion a etapas propias (§6) |
| R6 | Hay estatus que significan lo mismo con nombres distintos (`ENTREGADO`, `ENTREGADA`, `ENTREGA`, `ENTREGADO AL CLIENTE`) | La logica de negocio usa etapas, nunca el nombre crudo |
| R7 | `items[].unit_price` y `subtotal` pueden ser incoherentes (ej. 2 × 100 = 479.5) | Usar solo `total` de la orden |
| R8 | `get_order` no trae `shipping_company`; `list_orders` si | Guardar transportadora desde `list_orders` |
| R9 | No hay webhooks | Polling obligatorio |
| R10 | Telefonos llegan a 10 digitos sin lada (`2221841539`) | Normalizar a E.164 `+52XXXXXXXXXX` para WhatsApp |
| R11 | El MCP no da: nota de la orden, etiquetas, bodega, tienda Shopify / ID externo | Fuera de v1 |
| R12 | Si una orden cambia 2 veces en <5 min, solo vemos el ultimo cambio | Limite aceptado. Evidencia: en el caso real Tiui el menor intervalo entre estatus distintos fue 24 min |
| R13 | Dropi duplica registros en su timeline con la **misma hora exacta** (ej. 2× `ENVÍO RECOLECTADO` a las 3:58 p.m.) | Son duplicados, no eventos; no se detectan como cambio y es correcto |
| R14 | Los estatus **no siempre avanzan**: en el caso real Tiui, `ENVÍO RECOLECTADO` (3:58, transportadora) → `PREPARADO PARA TRANSPORTADORA` (4:22, marcado a mano por el proveedor) | Registros manuales tardios. Las etapas tienen rango; los mensajes solo salen al avanzar (§6) |
| R15 | El timeline de Dropi muestra **quien** hizo cada cambio (usuario/proveedor) y un historial de cartera; el MCP no da ninguno | Fuera de v1 |
| R16 | Los eventos de transportadora pueden llegar **tarde con hora retroactiva**: en el caso real, `PREPARADO PARA TRANSPORTADORA` (ID 53745183, 4:22) se guardo antes que `ENVÍO RECOLECTADO` (IDs 53749940-41, 3:58). Hipotesis, a confirmar en Fase 0 | `detected_at` = cuando nos enteramos, no cuando ocurrio. Metricas de tiempos usan `dropi_updated_at` y asumen posible retraso |
| R17 | La confirmacion manual (PENDIENTE CONFIRMACION → PENDIENTE) tardo ~12 h en el caso real | Medir en Fase 0; insumo para la decision D2 |

**Datos por orden disponibles:** order_id, status, customer (name, phone, address, city), items (product_id, product_name, qty), total, currency, rate_type (CON RECAUDO), shipping_company, tracking_code, created_at, updated_at.

---

## 5. Alcance por fases

| Fase | Nombre | Entregable | Criterio para pasar a la siguiente |
|---|---|---|---|
| **0** | Validador de estatus | Worker de polling + historial + tabla de traduccion + reporte | 2 semanas sin estatus perdidos ni desconocidos (§12) |
| **1** | Panel de lectura | Lista de ordenes, filtros, detalle con historial, "Abrir en Dropi" | Uso diario real por el dueño |
| **2** | Alertas al dueño | WhatsApp al dueño por novedad, devolucion y estatus desconocido | Cero alertas perdidas en 1 semana |
| **3** | WhatsApp al cliente | Templates aprobados por Meta, envio por cambio de etapa | Entregas confirmadas, sin duplicados |
| **4** | IA | Respuesta a "donde esta mi pedido", clasificacion de novedades | Precision aceptable revisada a mano |
| **5** | SaaS | Registro, onboarding OAuth por cliente, cobros, limites | Primer cliente externo pagando |

---

## 6. Modelo de etapas (normalizacion de estatus)

Cada estatus crudo se traduce a una etapa. **Fuente de verdad: `packages/core/src/status-map.ts`** (los 225 estatus clasificados, con prueba que falla si falta alguno). La tabla de abajo es un resumen; si difieren, manda el codigo. En Fase 0 la clasificacion vive en codigo; si hace falta editarla sin deploy, se migra a la tabla `status_map`.

**Principio para casos dudosos (`review`):** mapear a una etapa que solo alerta al dueño (`INCIDENCIA`/`DEVOLUCION`) y que sigue en polling. Una alerta de mas al dueño es barata; un mensaje equivocado al cliente no. La llave es `(carrier, raw_status)`; si no hay match por transportadora se usa `(NULL, raw_status)`.

| Etapa | Rango | Final? | Ejemplos de estatus crudos |
|---|---|---|---|
| `PENDIENTE` | 10 | No | PENDIENTE CONFIRMACION, PENDIENTE |
| `PREPARANDO` | 20 | No | GENERANDO_GUIA, GUIA_GENERADA, PREPARADO PARA TRANSPORTADORA, ENVÍO DOCUMENTADO *, PREPARANDO PAQUETE, CREADO, ORDEN CONFIRMADA EN SISTEMA, PEDIDO CREADO, EN CAMINO A RECOLECCIÓN |
| `EN_TRANSITO` | 30 | No | ENVÍO RECOLECTADO, RECOLECTADO, ENTREGADO A TRANSPORTADORA, EN TRANSITO, EN CAMINO A CIUDAD DE DESTINO, EN CIUDAD DE DESTINO, EN CEDIS *, EN TERMINAL DESTINO, EN RUTA ENTRE ESTACIONES, PREPARANDO RUTA |
| `EN_REPARTO` | 40 | No | EN RUTA DE ENTREGA, EN EL CAMINO A LA ENTREGA, EN PROCESO DE ENTREGA, EN REPARTO, ASIGNADO A MENSAJERO, LISTO PARA ENTREGA, ASIGNADO A UN OPERADOR PARA ENTREGA |
| `NOVEDAD` | — | No | NOVEDAD, INTENTO DE ENTREGA, NO VISITADO, CLIENTE NO LOCALIZADO, DIRECCION ERRONEA, DATOS INCORRECTOS, RECHAZADO POR EL CLIENTE EN LA ENTREGA, ENVÍO REAGENDADO, SIN ACCESO, EXCEPCION DE ENTREGA |
| `ENTREGADO` | 50 | Si* | ENTREGADO, ENTREGADA, ENTREGA, ENTREGADO AL CLIENTE, CONCILIADO, PAGADO |
| `DEVOLUCION` | — | No | DEVOLUCION EN TRANSITO, PARA DEVOLUCIÓN, EN CAMINO DE REGRESO A DEVOLUCION, PAQUETE PARA RETORNO, EN CAMINO A CIUDAD DE ORIGEN DEVOLUCIÓN |
| `DEVUELTO` | — | Si* | DEVUELTO, DEVOLUCION COMPLETADA, DEVUELTO A CLIENTE, INGRESADO A INVENTARIO, DEVOLUCION (solo 99Minutos) |
| `CANCELADO` | — | Si* | CANCELADO, CANCELADA, ANULADO, ORDEN ANULADA, ENVIO CANCELADO |
| `INCIDENCIA` | — | No | EXTRAVIADO, ROBADO, DAÑADO, SINIESTRO, INCAUTADO, PERDIDO, EXTRAVIO, ERROR_GENERANDO_GUIA, RECOGIDA FALLIDA, GUIA_ANULADA (review), RECHAZADO (review) |
| `DESCONOCIDO` | — | No | Cualquier estatus sin entrada en `status_map` → alerta inmediata |

\* "Final" significa que deja de vigilarse cada 5 min, no que se olvide (ver §7.3).

**Regla de avance (R14):** cada orden guarda `max_rank`, el rango mas alto que ha alcanzado. Un cambio a una etapa con rango menor (ej. `EN_TRANSITO` → `PREPARANDO`) se registra en el historial, pero **no** cambia la etapa mostrada en el panel ni dispara mensajes. Las etapas sin rango (`NOVEDAD`, `DEVOLUCION`, `DEVUELTO`, `CANCELADO`, `INCIDENCIA`, `DESCONOCIDO`) son excepciones: siempre se aplican y siempre alertan. Si despues de una `NOVEDAD` la orden vuelve a una etapa con rango, la etapa mostrada regresa a esa.

**Caso real de referencia (guia Tiui, entregada, 30/07/2026 1:03 p.m. → 02/08/2026 5:27 p.m., ~3 dias; tomado de capturas de otra cuenta, no consultable via nuestro MCP — se usa como fixture de prueba):**
`PENDIENTE CONFIRMACION → PENDIENTE → GUIA_GENERADA → ENVÍO RECOLECTADO → (ENVÍO RECOLECTADO) → PREPARADO PARA TRANSPORTADORA → EN CEDIS TIUI CDMX RECOLECCIÓN → PREPARANDO RUTA → (PREPARANDO RUTA) → EN RUTA DE ENTREGA → ENTREGADO`
Etapas resultantes: PENDIENTE → PREPARANDO → EN_TRANSITO → (retroceso ignorado) → EN_TRANSITO → EN_REPARTO → ENTREGADO. Mensajes al cliente: 3 (en camino, llega hoy, entregado). Este caso debe pasar como prueba automatica del motor de etapas.

**Tarea de Fase 0:** clasificar los 225 estatus de `list_statuses` en esta tabla y revisarla a mano. Los casos ambiguos (ej. `DEVOLUCION` sin transportadora, `INFORMACION`, `ERROR` de Quiken) se marcan `revisar = true`.

---

## 7. Requerimientos funcionales

### 7.1 Conexion con Dropi (MCP)
- RF-1.1 OAuth 2.0 + PKCE S256 contra el MCP (`https://mcp.dropi.co/mcp`), scope `mcp`.
- RF-1.2 Guardar access_token y refresh_token **cifrados** por tenant; renovar automaticamente antes de expirar.
- RF-1.3 Si el refresh falla, marcar la conexion como `desconectada` y alertar al dueño (no reintentar en loop).
- RF-1.4 Todo acceso a Dropi pasa por un unico modulo `DropiClient`. Cada respuesta se valida con Zod; si la forma cambia, se registra el error y no se escribe en la base.
- RF-1.5 Para produccion se registra un redirect URI propio (el actual `http://localhost:3000/callback` solo sirve en desarrollo).

### 7.2 Polling (Fase 0)
- RF-2.1 Cada 5 minutos, por tenant, llamar `list_orders` con `from = hoy − 45 dias`, `until = hoy`, paginando de 100 en 100.
- RF-2.2 Por cada orden: si no existe, insertarla y registrar su estatus inicial con `source = 'first_seen'`. Si existe y el estatus cambio, insertar fila en `order_status_history` y actualizar `orders`.
- RF-2.3 Cada fila de historial guarda: estatus anterior, estatus nuevo, etapa anterior, etapa nueva, `detected_at` (hora del polling) y `dropi_updated_at` si se conoce.
- RF-2.4 Si una orden cambio de estatus, llamar `get_order` para obtener `updated_at`, direccion y productos actualizados.
- RF-2.5 Idempotencia: llave unica `(order_id, new_status, dropi_updated_at)` para no duplicar historial si un polling se repite.
- RF-2.6 Cada ejecucion queda registrada en `poll_runs` (inicio, fin, ordenes leidas, cambios, errores).
- RF-2.7 Si una llamada falla: reintentar con backoff exponencial (3 intentos); si falla todo el ciclo, el siguiente ciclo lo recupera, porque la comparacion es contra el ultimo estado guardado.
- RF-2.8 Un estatus que no esta en `status_map` se guarda igual con etapa `DESCONOCIDO` y genera alerta.

### 7.3 Ordenes en etapa final
- RF-3.1 Ordenes en etapa final se revisan **una vez al dia** durante 15 dias (para captar reversos, conciliacion o devoluciones tardias) y despues se archivan.
- RF-3.2 Ordenes que salen de la ventana de 45 dias sin etapa final se consultan una por una con `get_order` una vez al dia y se marcan para revision manual.

### 7.4 Reporte de validacion (Fase 0)
- RF-4.1 Vista o script que muestra, por orden, su linea de tiempo detectada.
- RF-4.2 Contadores: cambios detectados por dia, estatus desconocidos, polls fallidos, ordenes sin movimiento >72 h.

### 7.5 Panel (Fase 1)
- RF-5.1 Tabla de ordenes con: ID, cliente, ciudad, producto, total, transportadora, etapa, estatus crudo, ultima actualizacion.
- RF-5.2 Filtros por etapa, fecha, ciudad, transportadora; busqueda por ID, nombre, telefono o guia.
- RF-5.3 Detalle de orden: datos del cliente, historial completo, mensajes de WhatsApp enviados y notas internas.
- RF-5.4 Boton "Abrir en Dropi" para confirmar, cancelar o editar.
- RF-5.5 Metricas: ordenes por dia, tasa de entrega, tasa de devolucion, tiempo promedio de entrega por transportadora.
- RF-5.6 Login con Supabase Auth; cada usuario solo ve los datos de su tenant (RLS).

### 7.6 WhatsApp (Fases 2 y 3)
- RF-6.1 Meta WhatsApp Cloud API directo (cuenta ya verificada). Mensajes iniciados por el negocio solo con **templates aprobados** de categoria *utility*.
- RF-6.2 El mensaje se dispara por **avance de etapa** (regla de §6), no por estatus crudo (evita spam: Tiui tiene 46 estatus) ni por retrocesos.
- RF-6.3 Matriz inicial:

| Transicion de etapa | Al cliente | Al dueño |
|---|---|---|
| → `EN_TRANSITO` (primera vez) | "Tu pedido va en camino, guia X" | — |
| → `EN_REPARTO` | "Tu pedido llega hoy, ten listo el pago de $X" | — |
| → `NOVEDAD` | "Hubo un problema con tu entrega, responde este mensaje" | Alerta inmediata |
| → `ENTREGADO` | "Gracias por tu compra" | — |
| → `DEVOLUCION` / `INCIDENCIA` | — | Alerta inmediata |
| → `DESCONOCIDO` | — | Alerta inmediata |

- RF-6.4 Un mismo template no se envia dos veces a la misma orden (llave unica `(order_id, template)`).
- RF-6.5 Horario silencioso: mensajes al cliente solo entre 8:00 y 21:00 hora local; fuera de horario se encolan.
- RF-6.6 Cola de envio con pg-boss: reintentos, registro de estado (enviado, entregado, leido, fallido) desde los webhooks de Meta.
- RF-6.7 Webhook de Meta recibe respuestas del cliente y las asocia a la orden activa de ese telefono.
- RF-6.8 Switch global y por tenant para pausar todos los envios.

### 7.7 IA (Fase 4)
- RF-7.1 Respuesta automatica a "donde esta mi pedido" usando solo datos de la base (sin inventar fechas).
- RF-7.2 Clasificacion de novedades: direccion, cliente ausente, rechazo, otro, con sugerencia de accion.
- RF-7.3 Toda respuesta automatica queda registrada y se puede desactivar por tenant.

---

## 8. Requerimientos no funcionales

| Area | Requerimiento |
|---|---|
| Confiabilidad | El worker se reinicia solo si cae; un fallo no pierde cambios (la comparacion es contra el estado guardado) |
| Latencia | Cambio de estatus detectado en ≤ 5 min; alerta al dueño en ≤ 6 min |
| Seguridad | Secretos solo en variables de entorno; tokens OAuth cifrados en BD; RLS en todas las tablas con `tenant_id` |
| Privacidad | Datos de clientes finales (telefono, direccion) solo visibles para su tenant; no se mandan a terceros salvo Meta y la IA cuando aplique |
| Observabilidad | `poll_runs`, logs estructurados y una prueba diaria de salud (OAuth vigente + una lectura) que alerta si falla |
| Costo | Infraestructura ≤ €10/mes en v1 |

---

## 9. Arquitectura

```
┌─────────────── VPS Hetzner (Docker Compose / Coolify + Caddy HTTPS) ───────────────┐
│                                                                                     │
│   web (Next.js)                        worker (Node + TypeScript)                   │
│   - Panel                              - Polling cada 5 min                         │
│   - Callback OAuth Dropi               - Revision diaria de finales                 │
│   - Webhook de Meta                    - Envio de WhatsApp (cola)                   │
│           │                                     │                                   │
└───────────┼─────────────────────────────────────┼───────────────────────────────────┘
            │                                     │
            ▼                                     ▼
      Supabase (proyecto NUEVO, separado del scraper)        MCP Dropi · Meta Cloud API · Claude API
      Postgres + Auth + RLS + pg-boss (cola)
```

| Pieza | Eleccion |
|---|---|
| Lenguaje | TypeScript en todo |
| Web | Next.js (App Router) + Tailwind + shadcn/ui |
| Worker | Node 20+, proceso separado, mismo repo |
| Cola y cron | pg-boss sobre Supabase Postgres (sin Redis) |
| Base de datos | Supabase, proyecto nuevo |
| Hosting | Hetzner CX22 (~€5/mes); en Fase 0 puede correr local |
| WhatsApp | Meta Cloud API |
| IA | Claude API |
| Validacion | Zod en cada respuesta externa |

Estructura de repo propuesta (monorepo simple):
```
apps/web/        Next.js
apps/worker/     polling + colas
packages/core/   DropiClient, esquemas Zod, status_map, tipos compartidos
supabase/        migraciones SQL
docs/            PRD y decisiones
```

---

## 10. Modelo de datos (todas las tablas llevan `tenant_id` + RLS)

| Tabla | Campos clave |
|---|---|
| `tenants` | id, name, timezone, whatsapp_enabled, created_at |
| `dropi_connections` | tenant_id, access_token (cifrado), refresh_token (cifrado), expires_at, status (`ok`/`desconectada`) |
| `orders` | tenant_id, order_id, status_raw, stage, max_rank, customer_name, phone_e164, address, city, total, currency, rate_type, shipping_company, tracking_code, items (jsonb), dropi_created_at, dropi_updated_at, first_seen_at, last_checked_at, is_final, archived_at |
| `order_status_history` | id, tenant_id, order_id, prev_status, new_status, prev_stage, new_stage, detected_at, dropi_updated_at, source (`first_seen`/`poll`/`daily_check`) |
| `status_map` | carrier (nullable), raw_status, stage, is_final, needs_review |
| `poll_runs` | id, tenant_id, started_at, finished_at, orders_read, changes, errors (jsonb) |
| `whatsapp_templates` | tenant_id, key, meta_template_name, language, stage_trigger, audience (`cliente`/`dueño`), enabled |
| `whatsapp_messages` | id, tenant_id, order_id, template_key, to_phone, status, meta_message_id, error, created_at |
| `order_notes` | id, tenant_id, order_id, author_id, body, created_at |
| `settings` | tenant_id, key, value (jsonb) |

`status_map` es global (no lleva `tenant_id`), porque los estatus de Dropi son los mismos para todos.

---

## 11. Riesgos

| Riesgo | Prob. | Impacto | Mitigacion |
|---|---|---|---|
| Dropi cambia o limita el MCP | Media | Alto | `DropiClient` unico + validacion Zod + prueba diaria de salud |
| Aparece un estatus nuevo | Alta | Medio | Etapa `DESCONOCIDO` + alerta + `status_map` editable sin deploy |
| Perder cambios rapidos (<5 min) | Media | Bajo | Aceptado; las notificaciones van por etapa, no por cada estatus |
| Template rechazado por Meta | Media | Medio | Redactar templates utility sin lenguaje promocional; tener 2 variantes |
| Bloqueo del numero de WhatsApp por reportes | Baja | Alto | Solo mensajes utiles, horario silencioso, sin duplicados, opcion de dejar de recibir |
| Volumen bajo para validar Fase 0 | Alta | Medio | Extender la validacion hasta tener ≥ 20 ordenes con ciclo completo |
| Supabase free se queda corto | Baja | Bajo | Migrar a Pro ($25) al tener clientes |

---

## 12. Metricas de exito

**Fase 0 (gate para todo lo demas):**
- 0 estatus desconocidos sin clasificar al cierre de la validacion.
- Para ≥ 20 ordenes con ciclo completo, el historial detectado coincide con el timeline del panel de Dropi (comparacion manual), salvo cambios separados por menos de 5 min.
- ≥ 99% de polls exitosos en 14 dias.

**Producto (Fases 1-3):**
- El dueño deja de entrar a Dropi para revisar estatus (solo entra para acciones).
- Tiempo entre novedad y alerta al dueño ≤ 6 min.
- Reduccion de la tasa de devolucion vs. el mes previo (linea base a medir en Fase 0).

---

## 13. Decisiones abiertas

| # | Decision | Recomendacion actual |
|---|---|---|
| D1 | ¿Ventana de polling de 45 dias es suficiente? | Medir en Fase 0 cuanto tarda el ciclo mas largo (COD con devolucion) |
| D2 | ¿Mensaje de confirmacion antes del envio ("confirma tu pedido")? | Alto valor en COD, pero confirmar en Dropi no se puede via MCP; evaluar en Fase 3 |
| D3 | ¿Numero de WhatsApp dedicado o el actual? | Dedicado, para no arriesgar el personal |
| D4 | ¿Cuando se activa multi-tenant real (onboarding de terceros)? | Despues de 1 mes de uso propio estable |
| D5 | ¿Acciones (confirmar/cancelar) via endpoints internos de Dropi? | No en v1; reevaluar si el trabajo manual es un cuello de botella |

---

## 14. Tareas previas al desarrollo

1. Sacar credenciales del `CLAUDE.md` a `.env.local` (fuera de git); cambiar password de Dropi y regenerar el TOTP.
2. Crear proyecto nuevo en Supabase.
3. Crear repo `dropi-ordenes` en GitHub (usuario `gio-code-25`).
4. Clasificar los 225 estatus en `status_map` (primer entregable de Fase 0).
