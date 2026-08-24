/**
 * verificar.mjs — chequeo end-to-end del schema y las reglas de acceso.
 *
 * Uso (con el server corriendo):
 *   node pb/verificar.mjs
 *   node pb/verificar.mjs http://192.168.1.50:8090
 *
 * No necesita dependencias: fetch nativo de Node 18+.
 * Crea un turno de prueba y lo borra al final.
 */

const BASE = process.argv[2] || 'http://127.0.0.1:8090'
const SUPER = { identity: 'admin@ruta40.local', password: 'ruta40admin' }

let pasaron = 0
let fallaron = 0

const ok = (label, cond, detalle) => {
  if (cond) {
    pasaron++
    console.log('  [32mOK[0m   ' + label)
  } else {
    fallaron++
    console.log('  [31mFALLA[0m ' + label + (detalle ? '  → ' + detalle : ''))
  }
}

const titulo = (t) => console.log('\n[1m' + t + '[0m')

/** Devuelve { status, body } sin tirar excepción por 4xx. */
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

// ═══════════════════════════════════════════════════════════════
titulo('0 · Server')
const salud = await api('GET', '/api/health')
ok('el server responde en ' + BASE, salud.status === 200, 'status ' + salud.status)
if (salud.status !== 200) {
  console.log('\n  Arrancá el server primero:  cd pb && ./pocketbase serve\n')
  process.exit(1)
}

const admin = await login('_superusers', SUPER.identity, SUPER.password)
ok('login superuser', !!admin)

// ═══════════════════════════════════════════════════════════════
titulo('1 · Colecciones')
const cols = await api('GET', '/api/collections?perPage=100', { token: admin.token })
const nombres = cols.body.items.map((c) => c.name)
for (const n of ['staff', 'productos', 'turnos', 'ordenes', 'orden_items', 'eventos']) {
  ok('existe la colección `' + n + '`', nombres.includes(n))
}
ok('la colección `users` por defecto NO existe', !nombres.includes('users'))

// ═══════════════════════════════════════════════════════════════
titulo('2 · Seed')
const staffTodos = await api('GET', '/api/collections/staff/records?perPage=100', { token: admin.token })
ok('3 registros en staff', staffTodos.body.totalItems === 3, 'hay ' + staffTodos.body.totalItems)
for (const rol of ['cajero', 'barman', 'jefe']) {
  ok('hay un ' + rol, staffTodos.body.items.some((s) => s.rol === rol))
}
const prodTodos = await api('GET', '/api/collections/productos/records?perPage=100', { token: admin.token })
ok('12 productos', prodTodos.body.totalItems === 12, 'hay ' + prodTodos.body.totalItems)
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

const pinMal = await login('staff', 'caja1', '0000')
ok('PIN incorrecto rechazado', !pinMal)

// ═══════════════════════════════════════════════════════════════
titulo('4 · Turno')
const ahora = new Date().toISOString()
const turnoRes = await api('POST', '/api/collections/turnos/records', {
  token: cajero.token,
  body: { fecha: ahora, abierto_at: ahora, abierto_por: cajero.record.id },
})
ok('el cajero abre turno', turnoRes.status === 200, JSON.stringify(turnoRes.body).slice(0, 160))
const turno = turnoRes.body

const turnoBarman = await api('POST', '/api/collections/turnos/records', {
  token: barman.token,
  body: { fecha: ahora, abierto_at: ahora, abierto_por: barman.record.id },
})
ok('el barman NO puede abrir turno', turnoBarman.status === 403 || turnoBarman.status === 400,
  'status ' + turnoBarman.status)

// ═══════════════════════════════════════════════════════════════
titulo('5 · EL PORTÓN — borrador es invisible para la barra')
const fernet = prodTodos.body.items.find((p) => p.nombre === 'Fernet con Coca')
const gin = prodTodos.body.items.find((p) => p.nombre === 'Gin Tonic')

const ordenRes = await api('POST', '/api/collections/ordenes/records', {
  token: cajero.token,
  body: { turno_id: turno.id, estado: 'borrador', cajero_id: cajero.record.id },
})
ok('el cajero crea una orden en borrador', ordenRes.status === 200,
  JSON.stringify(ordenRes.body).slice(0, 160))
const orden = ordenRes.body

const item1 = await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: orden.id, producto_id: fernet.id, cantidad: 2, estado: 'pendiente' },
})
const item2 = await api('POST', '/api/collections/orden_items/records', {
  token: cajero.token,
  body: { orden_id: orden.id, producto_id: gin.id, cantidad: 1, estado: 'pendiente' },
})
ok('el cajero carga 2 items', item1.status === 200 && item2.status === 200)

const ordenBarman = await api('POST', '/api/collections/ordenes/records', {
  token: barman.token,
  body: { turno_id: turno.id, estado: 'borrador', cajero_id: barman.record.id },
})
ok('el barman NO puede crear órdenes', ordenBarman.status === 403 || ordenBarman.status === 400,
  'status ' + ordenBarman.status)

const itemBarman = await api('POST', '/api/collections/orden_items/records', {
  token: barman.token,
  body: { orden_id: orden.id, producto_id: gin.id, cantidad: 1, estado: 'pendiente' },
})
ok('el barman NO puede agregar items', itemBarman.status === 403 || itemBarman.status === 400,
  'status ' + itemBarman.status)

let vistaBarra = await api('GET', '/api/collections/ordenes/records?filter=' + encodeURIComponent(`turno_id="${turno.id}"`), {
  token: barman.token,
})
ok('la barra NO ve la orden en borrador', vistaBarra.body.totalItems === 0,
  've ' + vistaBarra.body.totalItems)

let itemsBarra = await api('GET', '/api/collections/orden_items/records?filter=' + encodeURIComponent(`orden_id="${orden.id}"`), {
  token: barman.token,
})
ok('la barra NO ve los items en borrador', itemsBarra.body.totalItems === 0,
  've ' + itemsBarra.body.totalItems)

const vistaCaja = await api('GET', '/api/collections/ordenes/records?filter=' + encodeURIComponent(`turno_id="${turno.id}"`), {
  token: cajero.token,
})
ok('la caja SÍ ve su borrador', vistaCaja.body.totalItems === 1)

// ═══════════════════════════════════════════════════════════════
titulo('6 · Cobrar — congela precio, nombre, total y número')
const total = fernet.precio * 2 + gin.precio * 1

await api('PATCH', '/api/collections/orden_items/records/' + item1.body.id, {
  token: cajero.token,
  body: { precio_unit: fernet.precio, nombre_snapshot: fernet.nombre },
})
await api('PATCH', '/api/collections/orden_items/records/' + item2.body.id, {
  token: cajero.token,
  body: { precio_unit: gin.precio, nombre_snapshot: gin.nombre },
})
const cobro = await api('PATCH', '/api/collections/ordenes/records/' + orden.id, {
  token: cajero.token,
  body: {
    estado: 'cobrada',
    total,
    numero: 1,
    metodo_pago: 'efectivo',
    cobrada_at: new Date().toISOString(),
  },
})
ok('la orden pasa a cobrada', cobro.status === 200 && cobro.body.estado === 'cobrada',
  JSON.stringify(cobro.body).slice(0, 160))
ok('total congelado = ' + total, cobro.body.total === total)
ok('número corto asignado (1-999)', cobro.body.numero === 1)

const itemCobrado = await api('GET', '/api/collections/orden_items/records/' + item1.body.id, { token: cajero.token })
ok('precio_unit copiado del producto', itemCobrado.body.precio_unit === fernet.precio)
ok('nombre_snapshot copiado del producto', itemCobrado.body.nombre_snapshot === fernet.nombre)

const evCobrada = await api('POST', '/api/collections/eventos/records', {
  token: cajero.token,
  body: { orden_id: orden.id, tipo: 'cobrada', staff_id: cajero.record.id, payload: { total } },
})
ok('se escribe el evento `cobrada`', evCobrada.status === 200,
  JSON.stringify(evCobrada.body).slice(0, 160))

// precio_unit no se recalcula: subo el precio del producto y reviso la orden vieja
const subaPrecio = await api('PATCH', '/api/collections/productos/records/' + fernet.id, {
  token: jefe.token,
  body: { precio: fernet.precio + 5000 },
})
ok('el jefe puede cambiar precios', subaPrecio.status === 200)
const itemDespues = await api('GET', '/api/collections/orden_items/records/' + item1.body.id, { token: cajero.token })
ok('la orden ya cobrada NO muta al subir el precio', itemDespues.body.precio_unit === fernet.precio,
  'quedó en ' + itemDespues.body.precio_unit)
await api('PATCH', '/api/collections/productos/records/' + fernet.id, {
  token: jefe.token,
  body: { precio: fernet.precio },
})

const precioBarman = await api('PATCH', '/api/collections/productos/records/' + fernet.id, {
  token: barman.token,
  body: { precio: 1 },
})
ok('el barman NO puede tocar precios',
  precioBarman.status === 403 || precioBarman.status === 404 || precioBarman.status === 400,
  'status ' + precioBarman.status)

// ═══════════════════════════════════════════════════════════════
titulo('7 · Después del portón, la barra ve todo')
vistaBarra = await api('GET', '/api/collections/ordenes/records?filter=' + encodeURIComponent(`turno_id="${turno.id}"`), {
  token: barman.token,
})
ok('la barra AHORA ve la orden cobrada', vistaBarra.body.totalItems === 1,
  've ' + vistaBarra.body.totalItems)

itemsBarra = await api('GET', '/api/collections/orden_items/records?filter=' + encodeURIComponent(`orden_id="${orden.id}"`), {
  token: barman.token,
})
ok('la barra AHORA ve los 2 items', itemsBarra.body.totalItems === 2,
  've ' + itemsBarra.body.totalItems)

const claim = await api('PATCH', '/api/collections/orden_items/records/' + item1.body.id, {
  token: barman.token,
  body: { estado: 'preparando', barman_id: barman.record.id, claim_at: new Date().toISOString() },
})
ok('el barman hace claim del item', claim.status === 200 && claim.body.estado === 'preparando',
  JSON.stringify(claim.body).slice(0, 160))
ok('el claim deja barman_id', claim.body.barman_id === barman.record.id)
ok('el claim deja claim_at (para el timeout)', !!claim.body.claim_at)

const borrarItem = await api('DELETE', '/api/collections/orden_items/records/' + item2.body.id, {
  token: cajero.token,
})
ok('NADIE borra items de una orden ya cobrada (se anulan)',
  borrarItem.status === 403 || borrarItem.status === 404, 'status ' + borrarItem.status)

// ═══════════════════════════════════════════════════════════════
titulo('8 · `eventos` es append-only')
const editarEv = await api('PATCH', '/api/collections/eventos/records/' + evCobrada.body.id, {
  token: jefe.token,
  body: { tipo: 'otra_cosa' },
})
ok('el jefe NO puede editar un evento', editarEv.status === 403 || editarEv.status === 404,
  'status ' + editarEv.status)

const borrarEv = await api('DELETE', '/api/collections/eventos/records/' + evCobrada.body.id, {
  token: jefe.token,
})
ok('el jefe NO puede borrar un evento', borrarEv.status === 403 || borrarEv.status === 404,
  'status ' + borrarEv.status)

// ═══════════════════════════════════════════════════════════════
titulo('9 · Integridad')
const numeroDup = await api('POST', '/api/collections/ordenes/records', {
  token: cajero.token,
  body: { turno_id: turno.id, estado: 'cobrada', numero: 1, cajero_id: cajero.record.id },
})
ok('número duplicado en el mismo turno rechazado', numeroDup.status !== 200,
  'status ' + numeroDup.status)

// PocketBase aplica la regla de list como filtro SQL: un guest no recibe 403,
// recibe la lista vacía. Lo que importa es que no salga ni un registro.
const sinAuth = await api('GET', '/api/collections/productos/records')
ok('sin login el menú viene vacío', sinAuth.body.totalItems === 0,
  'devolvió ' + sinAuth.body.totalItems)

const estadoInvalido = await api('PATCH', '/api/collections/orden_items/records/' + item2.body.id, {
  token: barman.token,
  body: { estado: 'quemado' },
})
ok('estado fuera de la máquina de estados rechazado', estadoInvalido.status === 400,
  'status ' + estadoInvalido.status)

const staffPublico = await api('GET', '/api/collections/staff/records')
ok('sin login la lista de staff viene vacía', staffPublico.body.totalItems === 0,
  'devolvió ' + staffPublico.body.totalItems)

// ═══════════════════════════════════════════════════════════════
titulo('10 · Limpieza')
for (const ev of (await api('GET', '/api/collections/eventos/records?perPage=200&filter=' + encodeURIComponent(`orden_id="${orden.id}"`), { token: admin.token })).body.items) {
  await api('DELETE', '/api/collections/eventos/records/' + ev.id, { token: admin.token })
}
await api('DELETE', '/api/collections/ordenes/records/' + orden.id, { token: admin.token })
await api('DELETE', '/api/collections/turnos/records/' + turno.id, { token: admin.token })
const quedanOrdenes = await api('GET', '/api/collections/ordenes/records', { token: admin.token })
ok('base limpia: 0 órdenes de prueba', quedanOrdenes.body.totalItems === 0,
  'quedan ' + quedanOrdenes.body.totalItems)

// ═══════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(52))
console.log(`  ${pasaron} OK · ${fallaron} fallas`)
console.log('─'.repeat(52) + '\n')
process.exit(fallaron === 0 ? 0 : 1)
