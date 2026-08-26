/// <reference path="../pb_data/types.d.ts" />

/**
 * utils.js — helpers compartidos.
 *
 * OJO: este archivo NO termina en .pb.js a proposito. Si terminara, PocketBase
 * lo cargaria como hook. Es un modulo: se usa con require() ADENTRO de cada
 * handler, porque los handlers corren en runtimes separados y no ven el scope
 * del archivo que los registro.
 */

const TIMEOUT_MIN = 8
const MOTIVOS_ANULAR = ['se_cayo', 'cliente_se_fue', 'error_carga', 'sin_stock', 'otro']

/**
 * [TURNO-AUTO] La noche pertenece al dia en que ARRANCO, no al del reloj.
 *
 * El boliche abre 01:00 del sabado y cierra 06:00 del domingo. Si la fecha del
 * turno saliera del reloj, toda la venta del sabado a la noche figuraria como
 * domingo y el arqueo del sabado saldria vacio.
 *
 * Todo lo que pasa antes de las 6 de la mañana cuenta como el dia anterior.
 */
const HORAS_CORTE = 6

/**
 * Comodoro Rivadavia esta en UTC-3, todo el año (Argentina no cambia la hora
 * desde 2009). Hace falta explicito porque el server guarda en UTC: si el
 * corte se hiciera sobre UTC, a las 05:00 de la madrugada daria el dia
 * EQUIVOCADO, que es justo el caso que esto viene a arreglar.
 */
const UTC_OFFSET_LOCAL = -3

/**
 * Devuelve la fecha (sin hora) a la que pertenece un turno abierto en `abiertoAt`.
 *
 * Se resta el offset local Y las horas de corte de una sola vez: pasar a hora
 * local y despues restar 6 es lo mismo que restar 9 sobre UTC.
 *
 * Devuelve un string 'YYYY-MM-DD 00:00:00.000Z', o null si la fecha no parsea.
 */
function fechaDeTurno(abiertoAt) {
  const ms = new Date(String(abiertoAt).replace(' ', 'T')).getTime()
  if (isNaN(ms)) return null

  const corrido = new Date(ms + (UTC_OFFSET_LOCAL - HORAS_CORTE) * 3600000)
  const y = corrido.getUTCFullYear()
  const m = String(corrido.getUTCMonth() + 1).padStart(2, '0')
  const d = String(corrido.getUTCDate()).padStart(2, '0')
  return y + '-' + m + '-' + d + ' 00:00:00.000Z'
}

const TRANSICIONES = {
  pendiente: ['preparando'],
  preparando: ['listo'],
  listo: ['entregado'],
  entregado: [],
  anulado: [],
}

/**
 * Un campo date vacio NO es null: es un DateTime cero, y en JS todo objeto es
 * truthy. Sin esto, 'if (turno.get("cerrado_at"))' da true SIEMPRE.
 */
function sinFecha(v) {
  if (v === null || v === undefined || v === '') return true
  if (typeof v.isZero === 'function') return v.isZero()
  return String(v) === ''
}

/** Error con status HTTP. Tirarlo adentro de una transaccion la revierte. */
function fallo(status, mensaje) {
  const err = new Error(mensaje)
  err.statusTragos = status
  return err
}

function escribirEvento(app, ordenId, itemId, tipo, staffId, payload) {
  const ev = new Record(app.findCollectionByNameOrId('eventos'))
  ev.set('orden_id', ordenId)
  if (itemId) ev.set('item_id', itemId)
  ev.set('tipo', tipo)
  if (staffId) ev.set('staff_id', staffId)
  if (payload) ev.set('payload', payload)
  app.save(ev)
}

/**
 * Deriva el estado de la orden a partir de sus items.
 *
 * [PODA] Antes esto tenia 4 salidas (cobrada / en_preparacion / lista /
 * entregada). Ahora son 2, porque `en_preparacion` y `lista` se sacaron del
 * schema: eran una copia del estado de los items, guardada aparte, esperando
 * desincronizarse. Si queres saber si un pedido esta a medio hacer, mira los
 * items — que es donde vive el estado real (NO ROMPER #4).
 *
 * Una orden cobrada solo cambia cuando NO le queda nada por entregar.
 */
function derivarEstadoOrden(app, ordenId) {
  if (!ordenId) return
  const orden = app.findRecordById('ordenes', ordenId)
  if (!orden) return

  // Un borrador todavia no paso el porton: no se deriva nada.
  if (orden.get('estado') === 'borrador') return

  const items = app.findRecordsByFilter('orden_items', 'orden_id = {:oid}', '', 0, 0, { oid: ordenId })
  const activos = items.map((it) => it.get('estado')).filter((s) => s !== 'anulado')

  // Sin items activos (todos anulados) tambien cuenta como terminada.
  const terminada = activos.every((s) => s === 'entregado')
  const nuevo = terminada ? 'entregada' : 'cobrada'

  if (orden.get('estado') === nuevo) return

  orden.set('estado', nuevo)
  if (nuevo === 'entregada' && sinFecha(orden.get('entregada_at'))) {
    orden.set('entregada_at', new DateTime())
  }
  app.save(orden)
}

/** Tira 403 si el rol no esta permitido. */
function exigirRol(e, permitidos) {
  if (!e.auth) throw fallo(403, 'No autenticado')
  const rol = e.auth.get('rol')
  if (permitidos.indexOf(rol) === -1) {
    throw fallo(403, 'Esta operacion es solo para ' + permitidos.join(' o '))
  }
  return rol
}

/** Convierte los fallos en respuestas JSON legibles. */
function responder(e, fn) {
  try {
    return fn()
  } catch (err) {
    const status = err.statusTragos || 400
    return e.json(status, { code: status, message: err.message || 'Error' })
  }
}

module.exports = {
  sinFecha,
  fechaDeTurno,
  HORAS_CORTE,
  UTC_OFFSET_LOCAL,
  TIMEOUT_MIN,
  MOTIVOS_ANULAR,
  TRANSICIONES,
  fallo,
  escribirEvento,
  derivarEstadoOrden,
  exigirRol,
  responder,
}
