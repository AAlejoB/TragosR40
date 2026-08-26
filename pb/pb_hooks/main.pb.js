/// <reference path="../pb_data/types.d.ts" />

/**
 * main.pb.js — reglas de negocio del Sistema de Tragos.
 *
 * CUATRO reglas de PocketBase que ya nos mordieron. Respetarlas o no anda:
 *
 *   1. El archivo DEBE llamarse *.pb.js. Un .js comun no se carga NI AVISA.
 *   2. Cada handler corre en su propio runtime: NO ve funciones ni constantes
 *      declaradas afuera, en este mismo archivo. Todo se trae con require()
 *      adentro del handler, o se escribe inline.
 *   3. Por lo mismo, no pasarle callbacks propios a funciones del modulo.
 *      El try/catch va inline en cada handler.
 *   4. runInTransaction devuelve void y su callback recibe txApp. Usar txApp
 *      adentro, y responder DESPUES de que la transaccion cierre.
 *
 * Ver docs/BRIEF-HOOKS.md
 */

// ─────────────────────────────────────────────────────────────
// POST /api/tragos/cobrar   — EL PORTON
// ─────────────────────────────────────────────────────────────

routerAdd('POST', '/api/tragos/cobrar', (e) => {
  const u = require(`${__hooks}/utils.js`)

  try {
    u.exigirRol(e, ['cajero', 'jefe'])

    const body = e.requestInfo().body || {}
    if (!body.orden_id) throw u.fallo(400, 'Falta orden_id')
    if (!body.metodo_pago) throw u.fallo(400, 'Falta metodo_pago')

    const staffId = e.auth.id
    let salida = null

    $app.runInTransaction((txApp) => {
      const orden = txApp.findRecordById('ordenes', body.orden_id)
      if (!orden) throw u.fallo(404, 'La orden no existe')

      // Idempotencia: reintentar un cobro no crea una segunda venta.
      if (orden.get('estado') === 'cobrada') {
        salida = { numero: orden.get('numero'), total: orden.get('total'), repetido: true }
        return
      }

      if (orden.get('estado') !== 'borrador') {
        throw u.fallo(400, 'La orden esta en ' + orden.get('estado') + ', ya no se puede cobrar')
      }

      const turno = txApp.findRecordById('turnos', orden.get('turno_id'))
      if (!turno) throw u.fallo(400, 'La orden no tiene turno')
      if (!u.sinFecha(turno.get('cerrado_at'))) throw u.fallo(400, 'El turno esta cerrado')

      const items = txApp.findRecordsByFilter('orden_items', 'orden_id = {:oid}', '', 0, 0, { oid: orden.id })
      if (items.length === 0) throw u.fallo(400, 'La orden no tiene items')

      // Congelar precio y nombre. Se leen del producto, NUNCA del body.
      // Cada fila es UN trago (ver [PODA]: se saco `cantidad`), asi que el
      // total es la suma de los precios, sin multiplicar por nada.
      let total = 0
      for (const item of items) {
        const prod = txApp.findRecordById('productos', item.get('producto_id'))
        if (!prod) throw u.fallo(400, 'Un producto de la orden ya no existe')
        const precio = prod.get('precio')
        item.set('precio_unit', precio)
        item.set('nombre_snapshot', prod.get('nombre'))
        txApp.save(item)
        total += precio
      }

      // Numero corto: adentro de la transaccion, asi dos cajas no sacan el mismo.
      const previas = txApp.findRecordsByFilter('ordenes', 'turno_id = {:tid} && numero > 0', '', 0, 0, { tid: turno.id })
      let maxNumero = 0
      for (const o of previas) {
        const n = o.get('numero') || 0
        if (n > maxNumero) maxNumero = n
      }
      const numero = maxNumero + 1

      orden.set('numero', numero)
      orden.set('total', total)
      orden.set('metodo_pago', body.metodo_pago)
      orden.set('estado', 'cobrada')
      orden.set('cobrada_at', new DateTime())
      txApp.save(orden)

      u.escribirEvento(txApp, orden.id, null, 'cobrada', staffId, {
        total: total,
        metodo_pago: body.metodo_pago,
        items: items.length,
      })

      salida = { numero: numero, total: total, repetido: false }
    })

    return e.json(200, salida)
  } catch (err) {
    const status = err.statusTragos || 400
    return e.json(status, { code: status, message: err.message || 'Error' })
  }
}, $apis.requireAuth('staff'))

// ─────────────────────────────────────────────────────────────
// POST /api/tragos/claim   — el que gana la carrera se lo lleva
// ─────────────────────────────────────────────────────────────

routerAdd('POST', '/api/tragos/claim', (e) => {
  const u = require(`${__hooks}/utils.js`)

  try {
    u.exigirRol(e, ['barman', 'jefe'])

    const body = e.requestInfo().body || {}
    if (!body.item_id) throw u.fallo(400, 'Falta item_id')

    const staffId = e.auth.id

    $app.runInTransaction((txApp) => {
      const item = txApp.findRecordById('orden_items', body.item_id)
      if (!item) throw u.fallo(404, 'El item no existe')

      const barmanPrevio = item.get('barman_id')
      if (barmanPrevio) {
        let quien = 'otro barman'
        const otro = txApp.findRecordById('staff', barmanPrevio)
        if (otro) quien = otro.get('nombre')
        throw u.fallo(409, 'Lo esta preparando ' + quien)
      }

      if (item.get('estado') !== 'pendiente') {
        throw u.fallo(409, 'El trago esta en ' + item.get('estado'))
      }

      item.set('estado', 'preparando')
      item.set('barman_id', staffId)
      item.set('claim_at', new DateTime())
      txApp.save(item)

      u.escribirEvento(txApp, item.get('orden_id'), item.id, 'claim', staffId, null)
      u.derivarEstadoOrden(txApp, item.get('orden_id'))
    })

    return e.json(200, { ok: true })
  } catch (err) {
    const status = err.statusTragos || 400
    return e.json(status, { code: status, message: err.message || 'Error' })
  }
}, $apis.requireAuth('staff'))

// ─────────────────────────────────────────────────────────────
// POST /api/tragos/anular   — la unica puerta con llave
// ─────────────────────────────────────────────────────────────

routerAdd('POST', '/api/tragos/anular', (e) => {
  const u = require(`${__hooks}/utils.js`)

  try {
    u.exigirRol(e, ['barman', 'jefe'])

    const body = e.requestInfo().body || {}
    if (!body.item_id) throw u.fallo(400, 'Falta item_id')
    if (!body.motivo) throw u.fallo(400, 'Falta motivo')
    if (u.MOTIVOS_ANULAR.indexOf(body.motivo) === -1) {
      throw u.fallo(400, 'El motivo tiene que ser uno de: ' + u.MOTIVOS_ANULAR.join(', '))
    }

    const staffId = e.auth.id
    const staffNombre = e.auth.get('nombre')

    $app.runInTransaction((txApp) => {
      const item = txApp.findRecordById('orden_items', body.item_id)
      if (!item) throw u.fallo(404, 'El item no existe')

      const previo = item.get('estado')
      if (previo === 'anulado') throw u.fallo(400, 'El trago ya estaba anulado')

      // Anular algo ya entregado es reescribir plata cobrada: pide PIN del jefe.
      let autorizadoPor = staffNombre
      if (previo === 'entregado') {
        if (!body.pin_jefe) throw u.fallo(403, 'Anular un trago entregado necesita el PIN del jefe')
        let jefeOk = null
        const jefes = txApp.findRecordsByFilter('staff', 'rol = "jefe" && activo = true', '', 0, 0, {})
        for (const j of jefes) {
          try {
            if (j.validatePassword(body.pin_jefe)) { jefeOk = j; break }
          } catch (errPin) { /* no coincide, sigue */ }
        }
        if (!jefeOk) throw u.fallo(403, 'PIN del jefe incorrecto')
        autorizadoPor = jefeOk.get('nombre')
      }

      item.set('estado', 'anulado')
      txApp.save(item)

      u.escribirEvento(txApp, item.get('orden_id'), item.id, 'anulado', staffId, {
        motivo: body.motivo,
        estado_previo: previo,
        autorizado_por: autorizadoPor,
      })

      u.derivarEstadoOrden(txApp, item.get('orden_id'))
    })

    return e.json(200, { ok: true })
  } catch (err) {
    const status = err.statusTragos || 400
    return e.json(status, { code: status, message: err.message || 'Error' })
  }
}, $apis.requireAuth('staff'))

// ─────────────────────────────────────────────────────────────
// Guardas — rechazan lo que no puede pasar por PATCH
// ─────────────────────────────────────────────────────────────

onRecordUpdateRequest((e) => {
  const u = require(`${__hooks}/utils.js`)

  const rec = e.record
  const previo = e.app.findRecordById('orden_items', rec.id)
  const estadoPrevio = previo.get('estado')
  const estadoNuevo = rec.get('estado')

  if (estadoNuevo !== estadoPrevio) {
    if (estadoNuevo === 'anulado') {
      throw new BadRequestError('Para anular usa POST /api/tragos/anular (necesita motivo)')
    }
    if (estadoPrevio === 'pendiente' && estadoNuevo === 'preparando') {
      throw new BadRequestError('Para tomar un trago usa POST /api/tragos/claim')
    }
    const permitidas = u.TRANSICIONES[estadoPrevio] || []
    if (permitidas.indexOf(estadoNuevo) === -1) {
      throw new BadRequestError('No se puede pasar de ' + estadoPrevio + ' a ' + estadoNuevo)
    }
    if (estadoNuevo === 'listo' && previo.get('barman_id') !== e.auth.id) {
      throw new BadRequestError('Solo el barman que lo tomo puede marcarlo listo')
    }
  }

  // Precio congelado: una vez fuera de borrador, no se toca mas.
  const orden = e.app.findRecordById('ordenes', previo.get('orden_id'))
  if (orden && orden.get('estado') !== 'borrador') {
    if (rec.get('precio_unit') !== previo.get('precio_unit')) {
      throw new BadRequestError('precio_unit no se puede cambiar en una orden ya cobrada')
    }
    if (rec.get('nombre_snapshot') !== previo.get('nombre_snapshot')) {
      throw new BadRequestError('nombre_snapshot no se puede cambiar en una orden ya cobrada')
    }
  }

  // Claim ajeno.
  if (previo.get('barman_id') && rec.get('barman_id') !== previo.get('barman_id')) {
    throw new BadRequestError('El trago ya esta tomado por otro barman')
  }

  e.next()
}, 'orden_items')

onRecordUpdateRequest((e) => {
  const rec = e.record
  const previo = e.app.findRecordById('ordenes', rec.id)
  const estadoPrevio = previo.get('estado')
  const estadoNuevo = rec.get('estado')

  if (estadoNuevo !== estadoPrevio) {
    if (estadoNuevo === 'cobrada') {
      throw new BadRequestError('Para cobrar usa POST /api/tragos/cobrar')
    }
    // [PODA] `descartada` ya no existe: un borrador que no se cobra se BORRA
    // (deleteRule lo permite solo para borradores). Cualquier otro cambio de
    // estado lo hace el server derivando de los items.
    throw new BadRequestError('El estado de la orden se deriva de sus items, no se escribe')
  }

  if (estadoPrevio !== 'borrador') {
    if (rec.get('total') !== previo.get('total')) {
      throw new BadRequestError('total no se puede cambiar en una orden ya cobrada')
    }
    if (rec.get('numero') !== previo.get('numero')) {
      throw new BadRequestError('numero no se puede cambiar en una orden ya cobrada')
    }
  }

  e.next()
}, 'ordenes')

// Turno unico abierto.
onRecordCreateRequest((e) => {
  const u = require(`${__hooks}/utils.js`)
  if (u.sinFecha(e.record.get('cerrado_at'))) {
    const abiertos = e.app.findRecordsByFilter('turnos', 'cerrado_at = null', '', 0, 0, {})
    if (abiertos.length > 0) {
      throw new BadRequestError('Ya hay un turno abierto. Cerralo antes de abrir otro.')
    }
  }
  e.next()
}, 'turnos')

onRecordUpdateRequest((e) => {
  const u = require(`${__hooks}/utils.js`)
  if (u.sinFecha(e.record.get('cerrado_at'))) {
    const abiertos = e.app.findRecordsByFilter('turnos', 'cerrado_at = null && id != {:id}', '', 0, 0, { id: e.record.id })
    if (abiertos.length > 0) {
      throw new BadRequestError('Ya hay un turno abierto. Cerralo antes de abrir otro.')
    }
  }
  e.next()
}, 'turnos')

// No se crean ordenes contra un turno cerrado.
onRecordCreateRequest((e) => {
  const u = require(`${__hooks}/utils.js`)
  const turnoId = e.record.get('turno_id')
  if (turnoId) {
    const turno = e.app.findRecordById('turnos', turnoId)
    if (turno && !u.sinFecha(turno.get('cerrado_at'))) {
      throw new BadRequestError('El turno esta cerrado')
    }
  }
  e.next()
}, 'ordenes')

// ─────────────────────────────────────────────────────────────
// Derivacion del estado de la orden
// ─────────────────────────────────────────────────────────────

onRecordAfterUpdateSuccess((e) => {
  const u = require(`${__hooks}/utils.js`)
  u.derivarEstadoOrden(e.app, e.record.get('orden_id'))
  e.next()
}, 'orden_items')

// ─────────────────────────────────────────────────────────────
// Cron del timeout del claim
// ─────────────────────────────────────────────────────────────

cronAdd('timeout_claim', '* * * * *', () => {
  const u = require(`${__hooks}/utils.js`)

  try {
    const limite = new Date(Date.now() - u.TIMEOUT_MIN * 60 * 1000)
      .toISOString().replace('T', ' ').substring(0, 19)

    const colgados = $app.findRecordsByFilter(
      'orden_items',
      'estado = "preparando" && claim_at != null && claim_at < {:limite}',
      '', 0, 0, { limite: limite }
    )

    for (const item of colgados) {
      let nombrePrevio = 'desconocido'
      const barmanPrevio = item.get('barman_id')
      if (barmanPrevio) {
        const b = $app.findRecordById('staff', barmanPrevio)
        if (b) nombrePrevio = b.get('nombre')
      }

      item.set('estado', 'pendiente')
      item.set('barman_id', null)
      item.set('claim_at', null)
      $app.save(item)

      u.escribirEvento($app, item.get('orden_id'), item.id, 'timeout', null, {
        barman_previo: nombrePrevio,
        minutos: u.TIMEOUT_MIN,
      })

      u.derivarEstadoOrden($app, item.get('orden_id'))
    }

    if (colgados.length > 0) {
      console.log('[timeout] ' + colgados.length + ' trago(s) devueltos a pendiente')
    }
  } catch (err) {
    console.log('[timeout] error: ' + err)
  }
})

console.log('[hooks] Sistema de Tragos cargado OK')
