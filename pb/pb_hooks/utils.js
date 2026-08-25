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

function derivarEstadoOrden(app, ordenId) {
  if (!ordenId) return
  const orden = app.findRecordById('ordenes', ordenId)
  if (!orden) return

  const items = app.findRecordsByFilter('orden_items', 'orden_id = {:oid}', '', 0, 0, { oid: ordenId })
  const activos = items.map((it) => it.get('estado')).filter((s) => s !== 'anulado')

  let nuevo
  if (activos.length === 0) {
    nuevo = 'entregada'
  } else if (activos.every((s) => s === 'pendiente')) {
    nuevo = 'cobrada'
  } else if (activos.every((s) => s === 'entregado')) {
    nuevo = 'entregada'
  } else if (activos.every((s) => s === 'listo' || s === 'entregado')) {
    nuevo = 'lista'
  } else {
    nuevo = 'en_preparacion'
  }

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
  TIMEOUT_MIN,
  MOTIVOS_ANULAR,
  TRANSICIONES,
  fallo,
  escribirEvento,
  derivarEstadoOrden,
  exigirRol,
  responder,
}
