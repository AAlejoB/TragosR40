/**
 * verificar.mjs — chequeo end-to-end del schema, las reglas y los hooks.
 *
 * Uso (con el server corriendo):
 *   node pb/verificar.mjs
 *   node pb/verificar.mjs --rapido              (saltea la prueba del cron, ~70s)
 *   node pb/verificar.mjs http://192.168.1.50:8090
 *
 * No necesita dependencias: fetch nativo de Node 18+.
 * Limpia lo que crea, y tambien lo que haya quedado de una corrida anterior.
 */

const args = process.argv.slice(2)
const RAPIDO = args.includes('--rapido')
const BASE = args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8090'
const SUPER = { identity: 'admin@ruta40.local', password: 'ruta40admin' }

let pasaron = 0
let fallaron = 0

const ok = (label, cond, detalle) => {
  if (cond) {
    pasaron++
    console.log('  \x1b[32mOK\x1b[0m   ' + label)
  } else {
    fallaron++
    console.log('  \x1b[31mFALLA\x1b[0m ' + label + (detalle ? '  → ' + detalle : ''))
  }
}

const titulo = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m')
const nota = (t) => console.log('  \x1b[2m' + t + '\x1b[0m')

const api = async (metodo, path, { token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = token
  const res = await fetch(BASE + path, {
    method: metodo,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const texto = await res.text()
  let json = null
  try {
    json = texto ? JSON.parse(texto) : null
  } catch (err) {
    json = { raw: texto }
  }
  return { status: res.status, body: json }
}

const login = async (coleccion, identity, password) => {
  const r = await api('POST', `/api/collections/${coleccion}/auth-with-password`, {
    body: { identity, password },
  })
  return r.status === 200 ? r.body : null
}

const msg = (r) => r.status + ' ' + (r.body && r.body.message ? r.body.message : JSON.stringify(r.body))
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

// ═══════════════════════════════════════════════════════════════
titulo('0 · Server')
const salud = await api('GET', '/api/health')
ok('el server responde en ' + BASE, salud.status === 200, 'status ' + salud.status)
if (salud.status !== 200) {
  console.log('\n  Arrancá el server primero: doble clic en arrancar.cmd\n')
  process.exit(1)
}

const admin = await login('_superusers', SUPER.identity, SUPER.password)
ok('login superuser', !!admin)
if (!admin) process.exit(1)

// Limpieza previa: una corrida anterior cortada deja un turno abierto, y el
// hook de turno unico haria fallar todo lo que sigue.
const limpiarTodo = async () => {
  for (const col of ['eventos', 'orden_items', 'ordenes', 'turnos']) {
    const r = await api('GET', `/api/collections/${col}/records?perPage=500`, { token: admin.token })
    for (const rec of (r.body.items || [])) {
      await api('DELETE', `/api/collections/${col}/records/${rec.id}`, { token: admin.token })
    }
  }
}
await limpiarTodo()

// ═══════════════════════════════════════════════════════════════
titulo('1 · Colecciones')
const cols = await api('GET', '/api/collections?perPage=100', { token: admin.token })
const nombres = cols.body.items.map((c) => c.name)
for (const n of ['staff', 'productos', 'turnos', 'ordenes', 'orden_items', 'eventos']) {
  ok('existe la colección `' + n + '`', nombres.includes(n))
}
ok('la colección `users` por defecto NO existe', !nombres.includes('users'))

const colEventos = cols.body.items.find((c) => c.name === 'eventos')
ok('`eventos` no acepta escrituras desde afuera', colEventos.createRule === null,
  'createRule = ' + JSON.stringify(colEventos.createRule))

// ═══════════════════════════════════════════════════════════════
titulo('2 · Seed')
const staffTodos = await api('GET', '/api/collections/staff/records?perPage=100', { token: admin.token })
ok('3 registros en staff', staffTodos.body.totalItems === 3, 'hay ' + staffTodos.body.totalItems)
for (const rol of ['cajero', 'barman', 'jefe']) {
  ok('hay un ' + rol, staffTodos.body.items.some((s) => s.rol === rol))
}
const prodTodos = await api('GET', '/api/collections/productos/records?perPage=100', { token: admin.token })
// [PODA] 13: el seed reemplazo 'Quilmes 1L' por el par de 1/2 L y 1 L
ok('13 productos', prodTodos.body.totalItems === 13, 'hay ' + prodTodos.body.totalItems)
const cats = new Set(prodTodos.body.items.map((p) => p.categoria))
ok('las 4 categorías con al menos un producto', cats.size === 4, [...cats].join(', '))

// ═══════════════════════════════════════════════════════════════
titulo('3 · Login por PIN (identidad = usuario, no email)')
const cajero = await login('staff', 'caja1', '1111')
const barman = await login('staff', 'barra1', '2222')
const jefe = await login('staff', 'jefe', '9999')
ok('login cajero  caja1 / 1111', !!cajero)
ok('login barman  barra1 / 2222', !!barman)
ok('login jefe    jefe / 9999', !!jefe)
ok('el PIN no viaja en la respuesta', cajero && cajero.record.password === undefined)
ok('el rol viene en el record (lo usan las reglas)', cajero && cajero.record.rol === 'cajero')
ok('PIN incorrecto rechazado', !(await login('staff', 'caja1', '0000')))

// ═══════════════════════════════════════════════════════════════
titulo('4 · Turno')
const ahora = new Date().toISOString()
const turnoRes = await api('POST', '/api/collections/turnos/records', {
  token: cajero.token,
  body: { fecha: ahora, abierto_at: ahora, abierto_por: cajero.record.id },
})
ok('el cajero abre turno', turnoRes.status === 200, msg(turnoRes))
const turno = turnoRes.body

const turnoBarman = await api('POST', '/api/collections/turnos/records', {
  token: barman.token,
  body: { fecha: ahora, abierto_at: ahora, abierto_por: barman.record.id },
})
ok('el barman NO puede abrir turno', turnoBarman.status !== 200, msg(turnoBarman))

// ═══════════════════════════════════════════════════════════════
titulo('5 · EL PORTÓN — borrador es invisible para la barra')
const fernet = prodTodos.body.items.find((p) => p.nombre === 'Fernet con Coca')
const gin = prodTodos.body.items.find((p) => p.nombre === 'Gin Tonic')

const ordenRes = await api('POST', '/api/collections/ordenes/records', {
  token: cajero.token,
  body: { turno_id: turno.id, estado: 'borrador', cajero_id: cajero.record.id, metodo_pago: 'efectivo' },
})
ok('el cajero crea una orden en borrador', ordenRes.status === 200, msg(ordenRes))
const orden = ordenRes.body

const item1 = await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: orden.id, producto_id: fernet.id, estado: 'pendiente' },
})
const item2 = await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: orden.id, producto_id: gin.id, estado: 'pendiente' },
})
ok('el cajero carga 2 items', item1.status === 200 && item2.status === 200)

// [PODA] una fila por trago: el campo `cantidad` ya no existe
const conCantidad = await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: orden.id, producto_id: gin.id, estado: 'pendiente', cantidad: 5 },
})
const itemConCantidad = conCantidad.status === 200
  ? (await api('GET', '/api/collections/orden_items/records/' + conCantidad.body.id, { token: cajero.token })).body
  : null
ok('[PODA] orden_items ya NO tiene campo `cantidad`',
  itemConCantidad && itemConCantidad.cantidad === undefined,
  itemConCantidad ? 'devolvió cantidad = ' + itemConCantidad.cantidad : msg(conCantidad))
if (conCantidad.status === 200) {
  await api('DELETE', '/api/collections/orden_items/records/' + conCantidad.body.id, { token: cajero.token })
}

const ordenBarman = await api('POST', '/api/collections/ordenes/records', {
  token: barman.token,
  body: { turno_id: turno.id, estado: 'borrador', cajero_id: barman.record.id, metodo_pago: 'efectivo' },
})
ok('el barman NO puede crear órdenes', ordenBarman.status !== 200, msg(ordenBarman))

const itemBarman = await api('POST', '/api/collections/orden_items/records', {
  token: barman.token,
  body: { orden_id: orden.id, producto_id: gin.id, estado: 'pendiente' },
})
ok('el barman NO puede agregar items', itemBarman.status !== 200, msg(itemBarman))

const filtroTurno = '?filter=' + encodeURIComponent(`turno_id="${turno.id}"`)
const filtroItems = '?filter=' + encodeURIComponent(`orden_id="${orden.id}"`)

let vistaBarra = await api('GET', '/api/collections/ordenes/records' + filtroTurno, { token: barman.token })
ok('la barra NO ve la orden en borrador', vistaBarra.body.totalItems === 0, 've ' + vistaBarra.body.totalItems)

let itemsBarra = await api('GET', '/api/collections/orden_items/records' + filtroItems, { token: barman.token })
ok('la barra NO ve los items en borrador', itemsBarra.body.totalItems === 0, 've ' + itemsBarra.body.totalItems)

const vistaCaja = await api('GET', '/api/collections/ordenes/records' + filtroTurno, { token: cajero.token })
ok('la caja SÍ ve su borrador', vistaCaja.body.totalItems === 1)

// ═══════════════════════════════════════════════════════════════
titulo('6 · Cobrar — lo hace el servidor, no la pantalla')
// [PODA] cada fila es un trago: el total es la SUMA de los precios
const totalEsperado = fernet.precio + gin.precio

const cobroPatch = await api('PATCH', '/api/collections/ordenes/records/' + orden.id, {
  token: cajero.token,
  body: { estado: 'cobrada' },
})
ok('cobrar por PATCH está prohibido', cobroPatch.status !== 200, msg(cobroPatch))

const cobro = await api('POST', '/api/tragos/cobrar', {
  token: cajero.token,
  body: { orden_id: orden.id, metodo_pago: 'efectivo' },
})
ok('POST /api/tragos/cobrar devuelve 200', cobro.status === 200, msg(cobro))
ok('devuelve el número corto para gritar', cobro.body.numero === 1, 'numero = ' + cobro.body.numero)
ok('total calculado por el server = ' + totalEsperado, cobro.body.total === totalEsperado,
  'devolvió ' + cobro.body.total)

const ordenCobrada = await api('GET', '/api/collections/ordenes/records/' + orden.id, { token: cajero.token })
ok('la orden quedó en `cobrada`', ordenCobrada.body.estado === 'cobrada', ordenCobrada.body.estado)
ok('cobrada_at sellado', !!ordenCobrada.body.cobrada_at)

const itemCobrado = await api('GET', '/api/collections/orden_items/records/' + item1.body.id, { token: cajero.token })
ok('precio_unit congelado desde el producto', itemCobrado.body.precio_unit === fernet.precio,
  'quedó ' + itemCobrado.body.precio_unit)
ok('nombre_snapshot congelado desde el producto', itemCobrado.body.nombre_snapshot === fernet.nombre,
  'quedó ' + itemCobrado.body.nombre_snapshot)

const evCobrada = await api('GET', '/api/collections/eventos/records' + filtroItems.replace('orden_id', 'orden_id'), { token: jefe.token })
ok('el server escribió el evento `cobrada`',
  (evCobrada.body.items || []).some((ev) => ev.tipo === 'cobrada'),
  'eventos: ' + (evCobrada.body.items || []).map((e) => e.tipo).join(','))

// precio_unit no se recalcula
const subaPrecio = await api('PATCH', '/api/collections/productos/records/' + fernet.id, {
  token: jefe.token,
  body: { precio: fernet.precio + 5000 },
})
ok('el jefe puede cambiar precios', subaPrecio.status === 200, msg(subaPrecio))
const itemDespues = await api('GET', '/api/collections/orden_items/records/' + item1.body.id, { token: cajero.token })
ok('la orden ya cobrada NO muta al subir el precio', itemDespues.body.precio_unit === fernet.precio,
  'quedó en ' + itemDespues.body.precio_unit)
await api('PATCH', '/api/collections/productos/records/' + fernet.id, {
  token: jefe.token, body: { precio: fernet.precio },
})

const precioBarman = await api('PATCH', '/api/collections/productos/records/' + fernet.id, {
  token: barman.token, body: { precio: 1 },
})
ok('el barman NO puede tocar precios', precioBarman.status !== 200, msg(precioBarman))

// ═══════════════════════════════════════════════════════════════
titulo('7 · Después del portón, la barra ve y trabaja')
vistaBarra = await api('GET', '/api/collections/ordenes/records' + filtroTurno, { token: barman.token })
ok('la barra AHORA ve la orden cobrada', vistaBarra.body.totalItems === 1, 've ' + vistaBarra.body.totalItems)

itemsBarra = await api('GET', '/api/collections/orden_items/records' + filtroItems, { token: barman.token })
ok('la barra AHORA ve los 2 items', itemsBarra.body.totalItems === 2, 've ' + itemsBarra.body.totalItems)

const claimPatch = await api('PATCH', '/api/collections/orden_items/records/' + item1.body.id, {
  token: barman.token,
  body: { estado: 'preparando', barman_id: barman.record.id },
})
ok('tomar un trago por PATCH está prohibido', claimPatch.status !== 200, msg(claimPatch))

const claim = await api('POST', '/api/tragos/claim', {
  token: barman.token, body: { item_id: item1.body.id },
})
ok('POST /api/tragos/claim devuelve 200', claim.status === 200, msg(claim))

const itemClaim = await api('GET', '/api/collections/orden_items/records/' + item1.body.id, { token: barman.token })
ok('el claim deja el item en `preparando`', itemClaim.body.estado === 'preparando', itemClaim.body.estado)
ok('el claim deja barman_id', itemClaim.body.barman_id === barman.record.id)
ok('el claim deja claim_at (lo usa el timeout)', !!itemClaim.body.claim_at)

const ordenPrep = await api('GET', '/api/collections/ordenes/records/' + orden.id, { token: cajero.token })
ok('[PODA] con un trago en preparación la orden sigue en `cobrada`',
  ordenPrep.body.estado === 'cobrada', ordenPrep.body.estado)

const listo = await api('PATCH', '/api/collections/orden_items/records/' + item1.body.id, {
  token: barman.token, body: { estado: 'listo' },
})
ok('el barman que lo tomó lo marca listo', listo.status === 200, msg(listo))

const entregado = await api('PATCH', '/api/collections/orden_items/records/' + item1.body.id, {
  token: barman.token, body: { estado: 'entregado' },
})
ok('de listo pasa a entregado', entregado.status === 200, msg(entregado))

const borrarItem = await api('DELETE', '/api/collections/orden_items/records/' + item2.body.id, {
  token: cajero.token,
})
ok('NADIE borra items de una orden ya cobrada (se anulan)', borrarItem.status !== 200, msg(borrarItem))

// ═══════════════════════════════════════════════════════════════
titulo('8 · `eventos` es append-only y lo escribe solo el server')
const evs = await api('GET', '/api/collections/eventos/records?perPage=100', { token: jefe.token })
const unEvento = evs.body.items[0]

const inventarEvento = await api('POST', '/api/collections/eventos/records', {
  token: jefe.token,
  body: { orden_id: orden.id, tipo: 'cobrada', staff_id: jefe.record.id },
})
ok('nadie puede inventar un evento desde afuera', inventarEvento.status !== 200, msg(inventarEvento))

const editarEv = await api('PATCH', '/api/collections/eventos/records/' + unEvento.id, {
  token: jefe.token, body: { tipo: 'otra_cosa' },
})
ok('el jefe NO puede editar un evento', editarEv.status !== 200, msg(editarEv))

const borrarEv = await api('DELETE', '/api/collections/eventos/records/' + unEvento.id, {
  token: jefe.token,
})
ok('el jefe NO puede borrar un evento', borrarEv.status !== 200, msg(borrarEv))

// ═══════════════════════════════════════════════════════════════
titulo('9 · Integridad')
const sinAuth = await api('GET', '/api/collections/productos/records')
ok('sin login el menú viene vacío', sinAuth.body.totalItems === 0, 'devolvió ' + sinAuth.body.totalItems)

const staffPublico = await api('GET', '/api/collections/staff/records')
ok('sin login la lista de staff viene vacía', staffPublico.body.totalItems === 0,
  'devolvió ' + staffPublico.body.totalItems)

const estadoInvalido = await api('PATCH', '/api/collections/orden_items/records/' + item2.body.id, {
  token: barman.token, body: { estado: 'quemado' },
})
ok('estado fuera de la máquina de estados rechazado', estadoInvalido.status === 400, msg(estadoInvalido))

// ═══════════════════════════════════════════════════════════════
titulo('10 · Los 9 agujeros del diagnóstico, cerrados')

// #1 orden en turno cerrado
const turnoViejo = await api('POST', '/api/collections/turnos/records', {
  token: admin.token,
  body: { fecha: ahora, abierto_at: ahora, cerrado_at: ahora, abierto_por: cajero.record.id },
})
const ordenEnCerrado = await api('POST', '/api/collections/ordenes/records', {
  token: cajero.token,
  body: { turno_id: turnoViejo.body.id, estado: 'borrador', cajero_id: cajero.record.id, metodo_pago: 'efectivo' },
})
ok('#1 crear orden en turno CERRADO', ordenEnCerrado.status !== 200, msg(ordenEnCerrado))

// #2 y #3: cobrar sin congelar / total inventado — ya no existe la via.
//    El unico camino es el endpoint, que congela e ignora el total del body.
const ordenB = (await api('POST', '/api/collections/ordenes/records', {
  token: cajero.token,
  body: { turno_id: turno.id, estado: 'borrador', cajero_id: cajero.record.id, metodo_pago: 'efectivo', total: 1 },
})).body
await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: ordenB.id, producto_id: gin.id, estado: 'pendiente' },
})
await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: ordenB.id, producto_id: gin.id, estado: 'pendiente' },
})
await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: ordenB.id, producto_id: gin.id, estado: 'pendiente' },
})
const cobroB = await api('POST', '/api/tragos/cobrar', {
  token: cajero.token,
  body: { orden_id: ordenB.id, metodo_pago: 'tarjeta', total: 1 },
})
ok('#2 el server congela el precio aunque el body no lo mande', cobroB.status === 200, msg(cobroB))
ok('#3 el total del body se IGNORA (' + (gin.precio * 3) + ', no 1)', cobroB.body.total === gin.precio * 3,
  'devolvió ' + cobroB.body.total)

// #4 salto de estado
const itemB = (await api('GET', '/api/collections/orden_items/records?filter=' +
  encodeURIComponent(`orden_id="${ordenB.id}"`), { token: barman.token })).body.items[0]
const salto = await api('PATCH', '/api/collections/orden_items/records/' + itemB.id, {
  token: barman.token, body: { estado: 'entregado' },
})
ok('#4 saltar de pendiente a entregado', salto.status !== 200, msg(salto))

// #5 reescribir precio de orden cobrada
const reescribir = await api('PATCH', '/api/collections/orden_items/records/' + itemB.id, {
  token: cajero.token, body: { precio_unit: 1 },
})
ok('#5 cambiar precio_unit de una orden cobrada', reescribir.status !== 200, msg(reescribir))

// #6 pisar el claim de otro
await api('POST', '/api/tragos/claim', { token: barman.token, body: { item_id: itemB.id } })
const pisar = await api('PATCH', '/api/collections/orden_items/records/' + itemB.id, {
  token: jefe.token, body: { barman_id: jefe.record.id },
})
ok('#6 pisar el barman_id de un trago tomado', pisar.status !== 200, msg(pisar))

// #7 anular sin motivo ni evento
const anularMudo = await api('PATCH', '/api/collections/orden_items/records/' + itemB.id, {
  token: barman.token, body: { estado: 'anulado' },
})
ok('#7 anular por PATCH, sin motivo', anularMudo.status !== 200, msg(anularMudo))

const anularSinMotivo = await api('POST', '/api/tragos/anular', {
  token: barman.token, body: { item_id: itemB.id },
})
ok('#7 anular por endpoint sin motivo', anularSinMotivo.status !== 200, msg(anularSinMotivo))

const anularMotivoRaro = await api('POST', '/api/tragos/anular', {
  token: barman.token, body: { item_id: itemB.id, motivo: 'porque si' },
})
ok('#7 motivo fuera de la lista', anularMotivoRaro.status !== 200, msg(anularMotivoRaro))

// #8 orden que miente sobre sus items
const mentira = await api('PATCH', '/api/collections/ordenes/records/' + ordenB.id, {
  token: cajero.token, body: { estado: 'entregada' },
})
ok('#8 escribir el estado de la orden a mano', mentira.status !== 200, msg(mentira))

// [PODA] los 3 estados eliminados ya no existen en el select
for (const muerto of ['en_preparacion', 'lista', 'descartada']) {
  const r = await api('PATCH', '/api/collections/ordenes/records/' + ordenB.id, {
    token: cajero.token, body: { estado: muerto },
  })
  ok('[PODA] `' + muerto + '` es rechazado como estado de orden', r.status !== 200, msg(r))
}

// #9 dos turnos abiertos
const dobleTurno = await api('POST', '/api/collections/turnos/records', {
  token: cajero.token,
  body: { fecha: ahora, abierto_at: ahora, abierto_por: cajero.record.id },
})
ok('#9 abrir un segundo turno con otro abierto', dobleTurno.status !== 200, msg(dobleTurno))

// control: el numero SI se repite en otro turno (eso debe pasar)
ok('control: el número resetea por turno (índice único sólo dentro del turno)',
  cobro.body.numero === 1 && cobroB.body.numero === 2,
  'numeros: ' + cobro.body.numero + ', ' + cobroB.body.numero)

// ═══════════════════════════════════════════════════════════════
titulo('11 · Las carreras — pruebas 53 a 56 del brief')

// [53] cobrar dos veces
const ordenC = (await api('POST', '/api/collections/ordenes/records', {
  token: cajero.token,
  body: { turno_id: turno.id, estado: 'borrador', cajero_id: cajero.record.id, metodo_pago: 'efectivo' },
})).body
await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: ordenC.id, producto_id: fernet.id, estado: 'pendiente' },
})
const cobro1 = await api('POST', '/api/tragos/cobrar', {
  token: cajero.token, body: { orden_id: ordenC.id, metodo_pago: 'efectivo' },
})
const cobro2 = await api('POST', '/api/tragos/cobrar', {
  token: cajero.token, body: { orden_id: ordenC.id, metodo_pago: 'efectivo' },
})
ok('[53] cobrar dos veces devuelve el MISMO número',
  cobro1.status === 200 && cobro2.status === 200 && cobro1.body.numero === cobro2.body.numero,
  cobro1.body.numero + ' vs ' + cobro2.body.numero)
ok('[53] el reintento se marca como repetido', cobro2.body.repetido === true)

const ordenesTurno = await api('GET', '/api/collections/ordenes/records?perPage=100&filter=' +
  encodeURIComponent(`turno_id="${turno.id}"`), { token: cajero.token })
const numeros = ordenesTurno.body.items.map((o) => o.numero).filter((n) => n > 0)
ok('[53] no se creó una segunda venta', new Set(numeros).size === numeros.length,
  'numeros: ' + numeros.join(','))

// [54] dos barmans reclaman el mismo trago sin esperarse
const itemC = (await api('GET', '/api/collections/orden_items/records?filter=' +
  encodeURIComponent(`orden_id="${ordenC.id}"`), { token: barman.token })).body.items[0]

const [carreraA, carreraB] = await Promise.all([
  api('POST', '/api/tragos/claim', { token: barman.token, body: { item_id: itemC.id } }),
  api('POST', '/api/tragos/claim', { token: jefe.token, body: { item_id: itemC.id } }),
])
const ganadores = [carreraA, carreraB].filter((r) => r.status === 200)
const perdedores = [carreraA, carreraB].filter((r) => r.status !== 200)
ok('[54] gana exactamente UNO de los dos', ganadores.length === 1,
  'ganaron ' + ganadores.length)
ok('[54] el que pierde recibe 409', perdedores.length === 1 && perdedores[0].status === 409,
  perdedores.map(msg).join(' | '))
ok('[54] el 409 dice quién lo tiene',
  perdedores.length === 1 && /preparando/i.test(perdedores[0].body.message || ''),
  perdedores.length ? perdedores[0].body.message : '')

const itemCarrera = await api('GET', '/api/collections/orden_items/records/' + itemC.id, { token: barman.token })
ok('[54] barman_id quedó en uno solo, no pisado',
  itemCarrera.body.barman_id === barman.record.id || itemCarrera.body.barman_id === jefe.record.id,
  'quedó ' + itemCarrera.body.barman_id)

// [56] anular un entregado exige PIN del jefe
await api('PATCH', '/api/collections/orden_items/records/' + itemC.id, {
  token: itemCarrera.body.barman_id === barman.record.id ? barman.token : jefe.token,
  body: { estado: 'listo' },
})
await api('PATCH', '/api/collections/orden_items/records/' + itemC.id, {
  token: itemCarrera.body.barman_id === barman.record.id ? barman.token : jefe.token,
  body: { estado: 'entregado' },
})
const itemEntregado = await api('GET', '/api/collections/orden_items/records/' + itemC.id, { token: barman.token })
ok('[56] el item llegó a entregado', itemEntregado.body.estado === 'entregado', itemEntregado.body.estado)

const anularSinPin = await api('POST', '/api/tragos/anular', {
  token: barman.token, body: { item_id: itemC.id, motivo: 'se_cayo' },
})
ok('[56] anular un ENTREGADO sin PIN del jefe = 403', anularSinPin.status === 403, msg(anularSinPin))

const anularPinMalo = await api('POST', '/api/tragos/anular', {
  token: barman.token, body: { item_id: itemC.id, motivo: 'se_cayo', pin_jefe: '0000' },
})
ok('[56] PIN del jefe incorrecto = 403', anularPinMalo.status === 403, msg(anularPinMalo))

const anularPinOk = await api('POST', '/api/tragos/anular', {
  token: barman.token, body: { item_id: itemC.id, motivo: 'se_cayo', pin_jefe: '9999' },
})
ok('[56] con el PIN correcto = 200', anularPinOk.status === 200, msg(anularPinOk))

const evAnulado = (await api('GET', '/api/collections/eventos/records?perPage=200&filter=' +
  encodeURIComponent(`item_id="${itemC.id}" && tipo="anulado"`), { token: jefe.token })).body.items[0]
ok('[56] el evento guarda el motivo y quién autorizó',
  !!evAnulado && evAnulado.payload && evAnulado.payload.motivo === 'se_cayo' &&
  !!evAnulado.payload.autorizado_por,
  evAnulado ? JSON.stringify(evAnulado.payload) : 'sin evento')

// [55] timeout del claim
if (RAPIDO) {
  nota('[55] prueba del cron SALTEADA (--rapido). Corré sin la bandera para incluirla.')
} else {
  titulo('12 · [55] Timeout del claim — el cron tarda hasta 1 minuto')
  const ordenD = (await api('POST', '/api/collections/ordenes/records', {
    token: cajero.token,
    body: { turno_id: turno.id, estado: 'borrador', cajero_id: cajero.record.id, metodo_pago: 'efectivo' },
  })).body
  await api('POST', '/api/collections/orden_items/records', {
    token: cajero.token,
    body: { orden_id: ordenD.id, producto_id: gin.id, estado: 'pendiente' },
  })
  await api('POST', '/api/tragos/cobrar', {
    token: cajero.token, body: { orden_id: ordenD.id, metodo_pago: 'efectivo' },
  })
  const itemD = (await api('GET', '/api/collections/orden_items/records?filter=' +
    encodeURIComponent(`orden_id="${ordenD.id}"`), { token: barman.token })).body.items[0]

  await api('POST', '/api/tragos/claim', { token: barman.token, body: { item_id: itemD.id } })

  // envejecer el claim 20 minutos
  const viejo = new Date(Date.now() - 20 * 60 * 1000).toISOString()
  const envejecer = await api('PATCH', '/api/collections/orden_items/records/' + itemD.id, {
    token: admin.token, body: { claim_at: viejo },
  })
  ok('[55] se pudo envejecer claim_at a 20 min atrás', envejecer.status === 200, msg(envejecer))

  nota('esperando el cron (corre cada minuto, hasta 70s)...')
  let devuelto = null
  for (let i = 0; i < 14; i++) {
    await dormir(5000)
    const r = await api('GET', '/api/collections/orden_items/records/' + itemD.id, { token: barman.token })
    if (r.body.estado === 'pendiente') { devuelto = r.body; break }
    process.stdout.write('.')
  }
  console.log('')

  ok('[55] el trago colgado volvió a `pendiente`', !!devuelto,
    'sigue en preparando después de 70s')
  if (devuelto) {
    ok('[55] se limpió barman_id', !devuelto.barman_id, 'quedó ' + devuelto.barman_id)
    ok('[55] se limpió claim_at', !devuelto.claim_at, 'quedó ' + devuelto.claim_at)
    const evTimeout = (await api('GET', '/api/collections/eventos/records?perPage=200&filter=' +
      encodeURIComponent(`item_id="${itemD.id}" && tipo="timeout"`), { token: jefe.token })).body
    ok('[55] se escribió el evento `timeout`', evTimeout.totalItems > 0,
      'eventos timeout: ' + evTimeout.totalItems)
  }
}

// ═══════════════════════════════════════════════════════════════
titulo('12b · [PODA] — el modelo simplificado')

const colsAhora = await api('GET', '/api/collections?perPage=100', { token: admin.token })
const ordenesAhora = colsAhora.body.items.find((c) => c.name === 'ordenes')
const itemsAhora = colsAhora.body.items.find((c) => c.name === 'orden_items')
const productosAhora = colsAhora.body.items.find((c) => c.name === 'productos')

const campos = (col) => col.fields.map((f) => f.name)

ok('[PODA] `orden_items` no tiene el campo `cantidad`',
  !campos(itemsAhora).includes('cantidad'), campos(itemsAhora).join(', '))

const valoresEstado = ordenesAhora.fields.find((f) => f.name === 'estado').values
ok('[PODA] `ordenes.estado` acepta exactamente 3 valores',
  valoresEstado.length === 3, valoresEstado.join(', '))
ok('[PODA] los 3 valores son borrador · cobrada · entregada',
  ['borrador', 'cobrada', 'entregada'].every((v) => valoresEstado.includes(v)),
  valoresEstado.join(', '))

const campoMetodo = ordenesAhora.fields.find((f) => f.name === 'metodo_pago')
ok('[PODA] `metodo_pago` es obligatorio', campoMetodo.required === true,
  'required = ' + campoMetodo.required)

// una orden sin metodo_pago tiene que ser rechazada
const sinMetodo = await api('POST', '/api/collections/ordenes/records', {
  token: cajero.token,
  body: { turno_id: turno.id, estado: 'borrador', cajero_id: cajero.record.id },
})
ok('[PODA] una orden SIN metodo_pago es rechazada', sinMetodo.status !== 200, msg(sinMetodo))

// productos: grupo y etiqueta, ambos opcionales
ok('[PODA] `productos` tiene el campo `grupo`', campos(productosAhora).includes('grupo'))
ok('[PODA] `productos` tiene el campo `etiqueta`', campos(productosAhora).includes('etiqueta'))
ok('[PODA] `grupo` es opcional',
  productosAhora.fields.find((f) => f.name === 'grupo').required !== true)
ok('[PODA] `etiqueta` es opcional',
  productosAhora.fields.find((f) => f.name === 'etiqueta').required !== true)

const prodSinGrupo = await api('POST', '/api/collections/productos/records', {
  token: jefe.token,
  body: { nombre: 'Prueba sin grupo', categoria: 'trago', precio: 5000, activo: true, orden: 999 },
})
ok('[PODA] un producto SIN grupo sigue siendo válido', prodSinGrupo.status === 200, msg(prodSinGrupo))
if (prodSinGrupo.status === 200) {
  await api('DELETE', '/api/collections/productos/records/' + prodSinGrupo.body.id, { token: admin.token })
}

// el par de vasos del seed
const paresQuilmes = (await api('GET', '/api/collections/productos/records?filter=' +
  encodeURIComponent('grupo="quilmes"'), { token: jefe.token })).body
ok('[PODA] el seed tiene el par de vasos agrupado', paresQuilmes.totalItems === 2,
  'hay ' + paresQuilmes.totalItems)
ok('[PODA] las dos mitades tienen etiqueta distinta',
  new Set((paresQuilmes.items || []).map((p) => p.etiqueta)).size === 2,
  (paresQuilmes.items || []).map((p) => p.etiqueta).join(' / '))
ok('[PODA] y precios distintos (son productos separados de verdad)',
  new Set((paresQuilmes.items || []).map((p) => p.precio)).size === 2,
  (paresQuilmes.items || []).map((p) => p.precio).join(' / '))

// borrar un borrador: el deleteRule nuevo
const paraBorrar = await api('POST', '/api/collections/ordenes/records', {
  token: cajero.token,
  body: { turno_id: turno.id, estado: 'borrador', cajero_id: cajero.record.id, metodo_pago: 'efectivo' },
})
const borrarBorrador = await api('DELETE', '/api/collections/ordenes/records/' + paraBorrar.body.id, {
  token: cajero.token,
})
ok('[PODA] un borrador SE PUEDE borrar (reemplaza a `descartada`)',
  borrarBorrador.status === 204, msg(borrarBorrador))

// pero una cobrada NO
const borrarCobrada = await api('DELETE', '/api/collections/ordenes/records/' + orden.id, {
  token: cajero.token,
})
ok('[PODA] una orden COBRADA no se puede borrar (es plata cobrada)',
  borrarCobrada.status !== 204, msg(borrarCobrada))

// ═══════════════════════════════════════════════════════════════
titulo('12c · [TURNO-AUTO] — el turno se abre solo, con la fecha de la noche')

// La noche del boliche: abre 01:00 sábado y cierra 06:00 domingo. Todo lo de
// antes de las 6am cuenta como el día anterior.
// Se manda la hora LOCAL de Comodoro (UTC-3) y se espera el día correcto.
const horaLocal = (s) => new Date(s + '-03:00').toISOString()
const soloDia = (f) => String(f || '').slice(0, 10)

const casosFecha = [
  ['sábado 22:00 → sábado', '2026-08-29T22:00:00', '2026-08-29'],
  ['domingo 01:00 (el horario real) → sábado', '2026-08-30T01:00:00', '2026-08-29'],
  ['domingo 03:30 (pico de venta) → sábado', '2026-08-30T03:30:00', '2026-08-29'],
  ['domingo 05:59 (último trago) → sábado', '2026-08-30T05:59:00', '2026-08-29'],
  ['domingo 06:00 (ya es otro día) → domingo', '2026-08-30T06:00:00', '2026-08-30'],
]

for (const [etiqueta, local, esperado] of casosFecha) {
  const abierto = horaLocal(local)
  const t = await api('POST', '/api/collections/turnos/records', {
    token: admin.token,
    // se manda una fecha DELIBERADAMENTE equivocada: el server tiene que pisarla
    body: { fecha: abierto, abierto_at: abierto, cerrado_at: abierto, abierto_por: cajero.record.id },
  })
  ok('[TURNO-AUTO] ' + etiqueta, t.status === 200 && soloDia(t.body.fecha) === esperado,
    t.status === 200 ? 'quedó ' + soloDia(t.body.fecha) : msg(t))
  if (t.status === 200) await api('DELETE', '/api/collections/turnos/records/' + t.body.id, { token: admin.token })
}

// Auto-apertura: sin ningún turno abierto, el endpoint lo crea
await limpiarTodo()
const turnosAntes = await api('GET', '/api/collections/turnos/records', { token: admin.token })
ok('[TURNO-AUTO] partimos sin ningún turno', turnosAntes.body.totalItems === 0,
  'hay ' + turnosAntes.body.totalItems)

const autoUno = await api('POST', '/api/tragos/turno', { token: cajero.token })
ok('[TURNO-AUTO] el endpoint crea el turno si no hay', autoUno.status === 200 && autoUno.body.creado === true,
  msg(autoUno))

// Idempotente: llamarlo de nuevo devuelve el MISMO, no crea otro
const autoDos = await api('POST', '/api/tragos/turno', { token: cajero.token })
ok('[TURNO-AUTO] llamarlo de nuevo devuelve el mismo turno',
  autoDos.status === 200 && autoDos.body.id === autoUno.body.id && autoDos.body.creado === false,
  msg(autoDos))

// La carrera: dos cajas apretando COBRAR al mismo tiempo NO abren dos turnos
await limpiarTodo()
const carrera = await Promise.all([
  api('POST', '/api/tragos/turno', { token: cajero.token }),
  api('POST', '/api/tragos/turno', { token: jefe.token }),
  api('POST', '/api/tragos/turno', { token: cajero.token }),
])
const turnosTrasCarrera = await api('GET', '/api/collections/turnos/records', { token: admin.token })
ok('[TURNO-AUTO] 3 llamadas simultáneas abren UN SOLO turno (agujero #9)',
  turnosTrasCarrera.body.totalItems === 1,
  'quedaron ' + turnosTrasCarrera.body.totalItems)
ok('[TURNO-AUTO] las 3 devuelven el mismo id',
  new Set(carrera.filter((r) => r.status === 200).map((r) => r.body.id)).size === 1,
  carrera.map((r) => r.status === 200 ? r.body.id : msg(r)).join(' | '))

// El turno auto-abierto sirve para vender de verdad
const turnoAuto = turnosTrasCarrera.body.items[0]
const ordenAuto = (await api('POST', '/api/collections/ordenes/records', {
  token: cajero.token,
  body: { turno_id: turnoAuto.id, estado: 'borrador', cajero_id: cajero.record.id, metodo_pago: 'efectivo' },
})).body
await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: ordenAuto.id, producto_id: fernet.id, estado: 'pendiente' },
})
const cobroAuto = await api('POST', '/api/tragos/cobrar', {
  token: cajero.token, body: { orden_id: ordenAuto.id, metodo_pago: 'efectivo' },
})
ok('[TURNO-AUTO] se puede cobrar contra el turno auto-abierto',
  cobroAuto.status === 200 && cobroAuto.body.numero === 1, msg(cobroAuto))

// Un barman no abre turnos, ni por el endpoint nuevo
const turnoBarmanAuto = await api('POST', '/api/tragos/turno', { token: barman.token })
ok('[TURNO-AUTO] el barman NO puede abrir turno por el endpoint',
  turnoBarmanAuto.status === 403, msg(turnoBarmanAuto))

// ═══════════════════════════════════════════════════════════════
titulo('13 · Limpieza')
await limpiarTodo()
const quedanOrdenes = await api('GET', '/api/collections/ordenes/records', { token: admin.token })
const quedanTurnos = await api('GET', '/api/collections/turnos/records', { token: admin.token })
ok('base limpia: 0 órdenes de prueba', quedanOrdenes.body.totalItems === 0,
  'quedan ' + quedanOrdenes.body.totalItems)
ok('base limpia: 0 turnos de prueba', quedanTurnos.body.totalItems === 0,
  'quedan ' + quedanTurnos.body.totalItems)

const prodFinal = await api('GET', '/api/collections/productos/records?perPage=100', { token: admin.token })
ok('el seed quedó intacto: 13 productos', prodFinal.body.totalItems === 13,
  'hay ' + prodFinal.body.totalItems)

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(52))
console.log(`  ${pasaron} OK · ${fallaron} fallas`)
console.log('─'.repeat(52) + '\n')
process.exit(fallaron === 0 ? 0 : 1)
