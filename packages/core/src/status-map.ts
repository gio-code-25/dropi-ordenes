import { normalizeCarrier, normalizeStatus } from './normalize'
import { DEFAULT_FINAL_STAGES, type Stage } from './stages'

interface Rule {
  stage: Stage
  final?: boolean
  review?: boolean
}

export interface ResolvedStatus {
  stage: Stage
  isFinal: boolean
  needsReview: boolean
  matchedBy: 'carrier' | 'generic' | 'none'
}

const PEN: Rule = { stage: 'PENDIENTE' }
const PRE: Rule = { stage: 'PREPARANDO' }
const TRA: Rule = { stage: 'EN_TRANSITO' }
const REP: Rule = { stage: 'EN_REPARTO' }
const ENT: Rule = { stage: 'ENTREGADO' }
const NOV: Rule = { stage: 'NOVEDAD' }
const DEV: Rule = { stage: 'DEVOLUCION' }
const DVT: Rule = { stage: 'DEVUELTO' }
const CAN: Rule = { stage: 'CANCELADO' }
const INC: Rule = { stage: 'INCIDENCIA' }
const review = (rule: Rule, extra: Partial<Rule> = {}): Rule => ({ ...rule, ...extra, review: true })

// Source: MCP list_statuses (225 entries, 2026-10-23).
// When unsure, a status maps to an owner-only stage (INCIDENCIA/DEVOLUCION) and keeps
// being polled: a wrong owner alert is cheap, a wrong customer message is not.
const GENERIC: Record<string, Rule> = {
  'PENDIENTE CONFIRMACION': PEN,
  PENDIENTE: PEN,
  GENERANDO_GUIA: PRE,
  ERROR_GENERANDO_GUIA: INC,
  GUIA_GENERADA: PRE,
  GUIA_ANULADA: review(INC),
  CANCELADO: CAN,
  RECHAZADO: review(INC),
  ENTREGADO: ENT,
  DEVOLUCION: review(DEV),
  'NOVEDAD SOLUCIONADA': TRA,
  'PREPARADO PARA TRANSPORTADORA': PRE,
  'INDEMNIZADA POR DROPI': { ...INC, final: true },
  'DEVOLUCION EN TRANSITO': DEV,
  'ENTREGADO A TRANSPORTADORA': TRA,
  'EN BODEGA DROPI': review(DEV),
  'RECOGIDO POR DROPI': review(DEV),
  'RECIBIDO PAU': review(DEV),
  'RECIBIDO POR DROPI': review(DEV),
  'FINALIZADO POR RETENCION': review(INC, { final: true }),
  'PROCESO FINALIZADO': review(INC, { final: true }),
}

const BY_CARRIER: Record<string, Record<string, Rule>> = {
  '99Minutos': {
    'ENVIO DEBE SER CONFIRMADO': PRE,
    CONFIRMADO: PRE,
    'EN CAMINO A LA RECOGIDA': PRE,
    'RECIBIDO POR LA TRANSPORTADORA': TRA,
    'RECOGIDA FALLIDA': INC,
    'EN BODEGA TRANSPORTADORA': TRA,
    'EN TRANSITO': TRA,
    'EN EL CAMINO A LA ENTREGA': REP,
    ENTREGADO: ENT,
    NOVEDAD: NOV,
    'EN CAMINO DE REGRESO A DEVOLUCION': DEV,
    DEVOLUCION: review(DVT),
    'ENTREGA DE DEVOLUCION FALLIDA': INC,
    'EN CORRECCION': review(NOV),
    CORREGIDO: TRA,
    EXTRAVIADO: INC,
    'CLIENTE NO LOCALIZADO': NOV,
    'MERCANCIA MAL ESTADO': INC,
    'EN CONTAINER TRANSPORTADORA': TRA,
    'CARGADO AL VEHICULO': review(TRA),
    'MAXIMO INTENTOS DE RECOGIDA': INC,
    'LISTO PARA RECOGER': review(PRE),
  },
  Tiui: {
    'ENVÍO DOCUMENTADO CONSOLIDADO': PRE,
    'EN CAMINO A CDMX': TRA,
    'RECEPCIÓN DE ENVÍO CEDIS TIUI CDMX': TRA,
    'EN CEDIS TIUI CDMX CONSOLIDADO': TRA,
    'ENVÍO DOCUMENTADO FULFILLMENT': PRE,
    'PREPARANDO PAQUETE': PRE,
    'EN CEDIS TIUI CDMX FULFILLMENT': PRE,
    'EN ESPERA DE PRODUCTO': PRE,
    'EN RUTA DE ENTREGA': REP,
    'INTENTO DE ENTREGA': NOV,
    'ENVÍO REAGENDADO': NOV,
    CANCELADO: CAN,
    ENTREGADO: ENT,
    CONCILIADO: ENT,
    PAGADO: ENT,
    'ENVÍO DOCUMENTADO RECOLECCIÓN': PRE,
    'EN CAMINO A RECOLECCIÓN': PRE,
    'ENVÍO RECOLECTADO': TRA,
    'EN CEDIS TIUI CDMX RECOLECCIÓN': TRA,
    'PREPARANDO RUTA': TRA,
    'NO VISITADO': NOV,
    'ENVÍO PARA REVISIÓN': review(INC),
    'PARA DEVOLUCIÓN': DEV,
    DEVUELTO: DVT,
    'RECOLECCIÓN NO VISITADA': INC,
    'REPROGRAMAR RECOLECCIÓN': PRE,
    'INTENTO RECOLECCIÓN': PRE,
    ANULADO: CAN,
    'EN CAMINO A CIUDAD DE DESTINO': TRA,
    'EN CIUDAD DE DESTINO': TRA,
    'EN CAMINO A CIUDAD DE ORIGEN': review(TRA),
    'EN CIUDAD DE ORIGEN': review(TRA),
    'EN CEDIS': TRA,
    'EN CAMINO A CIUDAD DE DESTINO DEVOLUCIÓN': DEV,
    'EN CIUDAD DE DESTINO DEVOLUCIÓN': DEV,
    'EN CAMINO A CIUDAD DE ORIGEN DEVOLUCIÓN': DEV,
    'EN CIUDAD DE ORIGEN DEVOLUCIÓN': DEV,
    'PARA INGRESO INVENTARIO': DEV,
    'INGRESADO A INVENTARIO': DVT,
    'EN CEDIS CIUDAD ORIGEN DEVOLUCIÓN': DEV,
    'PARA INDEMNIZACIÓN': INC,
    'CIERRE LOGÍSTICO': review(INC, { final: true }),
  },
  Quiken: {
    CREADO: PRE,
    RECOLECTADO: TRA,
    'EN ALMACEN CIUDAD DE ORIGEN': TRA,
    'EN PROCESO DE RECOLECCION': PRE,
    ENTREGADO: ENT,
    INFORMACION: review(INC),
    ERROR: review(INC),
    CANCELADA: CAN,
    'ASIGNADO A UN OPERADOR PARA RECOLECCION': PRE,
    'ASIGNADO A UN OPERADOR PARA ENTREGA': REP,
    'EN BODEGA': TRA,
    'EN PROCESO DE ENTREGA': REP,
    DEVOLUCION: review(DEV),
    'EN RUTA A CIUDAD DESTINO': TRA,
    'EN ESPERA DE RECOLECCION OCURRE': review(NOV),
    'EN ALMACEN CIUDAD DESTINO': TRA,
    'EN CIUDAD DESTINO': TRA,
    'ENTRE ALMACENES': TRA,
    'INTENTO DE RECOLECCION': PRE,
    'GUIA CADUCADA': INC,
    'EN CEDIS DE INTERCAMBIO': TRA,
    EXTRAVIADO: INC,
  },
  Bigsmart: {
    'ORDEN CONFIRMADA EN SISTEMA': PRE,
    'SALIDA DE ESTACION': TRA,
    'EN RUTA ENTRE ESTACIONES': TRA,
    'DISPONIBLE PARA RECOLECTAR': PRE,
    'PAQUETE PARA RETORNO': DEV,
    'ENTRE ESTACIONES PARA RETORNO': DEV,
    'RECIBIDO EN ESTACION PARA RETORNO': DEV,
    'DEVOLUCION COMPLETADA': DVT,
    'RECIBIDO EN ESTACION': TRA,
    'EN ESTACION EQUIVOCADA': INC,
    PROCESANDO: PRE,
    PERDIDO: INC,
    DAÑADO: INC,
    'VOLVER A LA ESTACION': review(NOV),
    'RETORNO A LA ESTACION': review(NOV),
    'EN ESPERA': review(TRA),
    'LISTO PARA ENTREGA': REP,
    REPROGRAMADO: NOV,
    ROBADO: INC,
    'DATOS INCORRECTOS': NOV,
    'ORDEN DUPLICADA': review(INC),
    'ORDEN MAL SURTIDA': INC,
    'ESTACION EQUIVOCADA': INC,
    'CAMBIO DE DIRECCION': NOV,
    'ORDEN ANULADA': CAN,
    CANCELADO: CAN,
    'DATOS ACTUALIZADOS': TRA,
    'EN RUTA': review(REP),
    'INTENTADOS NO ENTREGADOS': NOV,
    'CLIENTE NO DISPONIBLE (DND)': NOV,
    'NEGOCIO CERRADO': NOV,
    'SIN ACCESO': NOV,
    'DIRECCION ERRONEA': NOV,
    'FUERA DE TIEMPO DE ENTREGA': review(INC),
    'RECHAZADO POR EL CLIENTE EN LA ENTREGA': NOV,
    'FUERA DE COBERTURA': INC,
    'NO ENTREGABLE FUERZA MAYOR': INC,
    'DEMORAS POR CUESTIONES CLIMATOLOGICAS': review(TRA),
    'DEMORA POR FALLA MECANICA': review(TRA),
    REZAGO: review(INC),
    ABANDONO: INC,
    'REGRESO A LA ESTACION': review(NOV),
    'ENTREGADO AL CLIENTE': ENT,
  },
  Veloces: {
    'EN BODEGA ORIGEN': TRA,
    'EN RUTA': review(TRA),
    ENTREGADO: ENT,
    NOVEDAD: NOV,
    CANCELADO: CAN,
    'EN CAMINO': TRA,
    DEVOLUCION: review(DEV),
    RECOLECCION: PRE,
    RECOGIDO: TRA,
    'EN TRANSITO': TRA,
    'BODEGA DESTINO': TRA,
    SINIESTRO: INC,
    INCAUTADO: INC,
    'EN PROCESO DE DEVOLUCION': DEV,
    'RECIBIDO PUNTO DE VENTA': review(INC),
    'TRANSITO A DEVOLUCION PROVEEDOR': DEV,
    'NOVEDAD DEVOLUCION': DEV,
    'DEVOLUCION EN BODEGA': review(DVT),
    'DEVOLUCION EN RUTA': DEV,
  },
  Fedex: {
    'EN EL AEROPUERTO': TRA,
    'EN CENTRO DE DISTRIBUCION DE CANADA': TRA,
    'LISTO PARA ENTREGAR': review(REP),
    'EN LAS INSTALACIONES DE FEDEX': TRA,
    'ENVIO LLEGANDO A TIEMPO': TRA,
    'LISTO PARA SER RECOGIDO': review(NOV),
    LLEGO: review(TRA),
    'EN LAS INSTALACIONES DE USPS': TRA,
    'ENVIO CANCELADO': CAN,
    'SE CAMBIO LA UBICACION': review(TRA),
    'RETRASO EN LA ENTREGA': review(TRA),
    'EXCEPCION DE ENTREGA': NOV,
    ENTREGADO: ENT,
    'YA PARTIO': TRA,
    'VEHICULO PROVISTO PERO NO UTILIZADO': review(PRE),
    'VEHICULO DESPACHADO': review(PRE),
    RETRASO: review(TRA),
    'EN RUTA AL AEROPUERTO': TRA,
    'EN RUTA PARA LA ENTREGA': REP,
    'EN RUTA AL AEROPUERTO DE ORIGEN': TRA,
    'EN RUTA A LA RECOLECCION': PRE,
    'EN DESTINO FEDEX': TRA,
    'RETENER EN OFICINA': review(NOV),
    'EN TRANSITO': TRA,
    'EN TRANSITO (CONSULTE LOS DETALLES)': review(TRA),
    'DEJO EL LUGAR DE ORIGEN': TRA,
    'PEDIDO CREADO': PRE,
    'LISTO PARA LA ENTREGA': review(REP),
    'EN OFICINA DE ORIGEN FEDEX': TRA,
    'INFORMACION DEL ENVIO ENVIADA A USPS': PRE,
    'DEMORA EN LA RECOLECCION': review(PRE),
    'EN CAMINO': TRA,
    DEVOLUCION: review(DEV),
  },
  Coordi: {
    'GUIA NO EXISTE': INC,
    'A RECIBIR POR COORDINADORA': PRE,
    'EN TERMINAL ORIGEN': TRA,
    'EN TRANSPORTE': TRA,
    'EN TERMINAL DESTINO': TRA,
    'EN REPARTO': REP,
    ENTREGADA: ENT,
    'CERRADO POR INCIDENCIA, VER CAUSA': review(INC, { final: true }),
    'EN PUNTO DROOP': review(NOV),
  },
  'Quality-Post': {
    PETICION: PRE,
    CREACIÓN: PRE,
    RECEPCION: TRA,
    'SALIDA DE CENTRO DE DISTRIBUCION': TRA,
    'RECEPCION CENTRO DE ENTREGA': TRA,
    'ASIGNADO A MENSAJERO': REP,
    ENTREGA: ENT,
    DEVOLUCION: review(DEV),
    'PAQUETE EN DEVOLUCION': DEV,
    'DEVOLUCION RECIBIDA EN CENTRO DE DISTRIBUCION': DEV,
    'DEVUELTO A CLIENTE': DVT,
    ROBO: INC,
    EXTRAVIO: INC,
    'ENVIO RETORNADO AL CLIENTE CONFIRMADO': DVT,
  },
}

function index(rules: Record<string, Rule>): Map<string, Rule> {
  return new Map(Object.entries(rules).map(([status, rule]) => [normalizeStatus(status), rule]))
}

const GENERIC_INDEX = index(GENERIC)
const CARRIER_INDEX = new Map(
  Object.entries(BY_CARRIER).map(([carrier, rules]) => [normalizeCarrier(carrier), index(rules)]),
)

function toResolved(rule: Rule, matchedBy: ResolvedStatus['matchedBy']): ResolvedStatus {
  return {
    stage: rule.stage,
    isFinal: rule.final ?? DEFAULT_FINAL_STAGES.has(rule.stage),
    needsReview: rule.review ?? false,
    matchedBy,
  }
}

export function resolveStatus(carrier: string | null | undefined, rawStatus: string): ResolvedStatus {
  const status = normalizeStatus(rawStatus)
  const carrierRule = carrier ? CARRIER_INDEX.get(normalizeCarrier(carrier))?.get(status) : undefined
  if (carrierRule) return toResolved(carrierRule, 'carrier')
  const genericRule = GENERIC_INDEX.get(status)
  if (genericRule) return toResolved(genericRule, 'generic')
  return { stage: 'DESCONOCIDO', isFinal: false, needsReview: true, matchedBy: 'none' }
}

export function listStatusRules(): Array<{ carrier: string | null; status: string } & ResolvedStatus> {
  const generic = Object.entries(GENERIC).map(([status, rule]) => ({ carrier: null, status, ...toResolved(rule, 'generic') }))
  const byCarrier = Object.entries(BY_CARRIER).flatMap(([carrier, rules]) =>
    Object.entries(rules).map(([status, rule]) => ({ carrier, status, ...toResolved(rule, 'carrier') })),
  )
  return [...generic, ...byCarrier]
}
