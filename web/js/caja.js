/**
 * caja.js — pantalla del cajero.
 *
 * El carrito vive en memoria hasta que se cobra. Recién ahí se crea la orden
 * y sus items, y se llama a POST /api/tragos/cobrar. Se hace así para no
 * dejar borradores huérfanos cada vez que alguien empieza un pedido y se
 * arrepiente.
 *
 * Si el cobro se corta después de crear la orden, el id queda guardado y se
 * reintenta sobre la MISMA orden: el endpoint es idempotente, así que no se
 * puede cobrar dos veces por accidente.
 */

const CLAVE_COBRO_PENDIENTE = 'tragos_cobro_pendiente'

const estado = {
  productos: [],
  turno: null,
  carrito: [],          // [{ producto, cantidad }]
  metodoPago: 'efectivo',
  categoria: 'trago',
  ordenes: [],
  cobrando: false,
}

const $ = (sel) => document.querySelector(sel)

// ── Carrito ──────────────────────────────────────────────────

const agregar = (producto) => {
  const linea = estado.carrito.find((l) => l.producto.id === producto.id)
  if (linea) linea.cantidad += 1
  else estado.carrito.push({ producto, cantidad: 1 })
  pintarCarrito()
}

const cambiarCantidad = (idProducto, delta) => {
  const i = estado.carrito.findIndex((l) => l.producto.id === idProducto)
  if (i < 0) return
  estado.carrito[i].cantidad += delta
  if (estado.carrito[i].cantidad <= 0) estado.carrito.splice(i, 1)
  pintarCarrito()
}

const totalCarrito = () =>
  estado.carrito.reduce((t, l) => t + l.producto.precio * l.cantidad, 0)

const vaciarCarrito = () => {
  estado.carrito = []
  pintarCarrito()
}

// ── Pintado ──────────────────────────────────────────────────

const pintarTabs = () => {
  $('#tabs').innerHTML = CATEGORIAS
    .map((c) => `<button class="tab ${c.valor === estado.categoria ? 'activa' : ''}" data-cat="${c.valor}">${UI.esc(c.etiqueta)}</button>`)
    .join('')
}

const pintarMenu = () => {
  const lista = estado.productos.filter((p) => p.categoria === estado.categoria && p.activo)
  if (!lista.length) {
    $('#menu').innerHTML = '<div class="vacio">No hay productos activos en esta categoría.</div>'
    return
  }
  $('#menu').innerHTML = lista.map((p) => `
    <button class="producto" data-prod="${p.id}">
      <span class="nom">${UI.esc(p.nombre)}</span>
      <span class="pre">${plata(p.precio)}</span>
    </button>`).join('')
}

const pintarCarrito = () => {
  const cont = $('#carrito')
  if (!estado.carrito.length) {
    cont.innerHTML = '<div class="vacio">Tocá un trago del menú<br>para empezar el pedido.</div>'
  } else {
    cont.innerHTML = estado.carrito.map((l) => `
      <div class="linea">
        <div class="cant">
          <button data-menos="${l.producto.id}">−</button>
          <span class="n">${l.cantidad}</span>
          <button data-mas="${l.producto.id}">+</button>
        </div>
        <div class="nom">${UI.esc(l.producto.nombre)}
          <div class="sub">${plata(l.producto.precio)} c/u</div>
        </div>
        <div class="imp">${plata(l.producto.precio * l.cantidad)}</div>
      </div>`).join('')
  }

  $('#total').textContent = plata(totalCarrito())
  $('#btn-cobrar').disabled = !estado.carrito.length || estado.cobrando || !estado.turno
  $('#btn-vaciar').style.visibility = estado.carrito.length ? 'visible' : 'hidden'
}

const pintarPagos = () => {
  $('#pagos').innerHTML = METODOS_PAGO
    .map((m) => `<button class="pago ${m.valor === estado.metodoPago ? 'elegido' : ''}" data-pago="${m.valor}">${UI.esc(m.etiqueta)}</button>`)
    .join('')
}

const pintarOrdenes = () => {
  const cont = $('#ordenes')
  const lista = estado.ordenes.filter((o) => o.numero > 0).slice(0, 40)
  if (!lista.length) {
    cont.innerHTML = '<div class="vacio">Todavía no cobraste nada en este turno.</div>'
    return
  }
  cont.innerHTML = lista.map((o) => `
    <div class="orden-chip">
      <span class="num">${o.numero}</span>
      <span class="pill ${o.estado}">${UI.esc(ETIQUETAS_ORDEN[o.estado] || o.estado)}</span>
      <span class="espaciador"></span>
      <span class="imp">${plata(o.total)}</span>
    </div>`).join('')
}

const pintarTurno = () => {
  const hay = !!estado.turno
  $('#sin-turno').style.display = hay ? 'none' : 'flex'
  $('#con-turno').style.display = hay ? 'flex' : 'none'
  $('#btn-cerrar-turno').style.display = hay ? 'inline-flex' : 'none'
  pintarCarrito()
}

// ── Datos ────────────────────────────────────────────────────

const cargarProductos = async () => {
  estado.productos = await PB.listar('productos', { orden: 'orden,nombre' })
  pintarMenu()
}

const buscarTurnoAbierto = async () => {
  const abiertos = await PB.listar('turnos', { filtro: 'cerrado_at = null', orden: '-abierto_at' })
  estado.turno = abiertos[0] || null
  pintarTurno()
}

const cargarOrdenes = async () => {
  if (!estado.turno) {
    estado.ordenes = []
    pintarOrdenes()
    return
  }
  estado.ordenes = await PB.listar('ordenes', {
    filtro: PB.filtro({ turno_id: estado.turno.id }),
    orden: '-numero',
  })
  pintarOrdenes()
}

// ── Turno ────────────────────────────────────────────────────

const abrirTurno = async () => {
  const ahora = new Date().toISOString()
  const r = await PB.pedir('POST', '/api/collections/turnos/records', {
    fecha: ahora,
    abierto_at: ahora,
    abierto_por: PB.staff.id,
  })
  if (!r.ok) {
    UI.avisar(r.mensaje, 'mala')
    // pudo abrirlo otra caja: recargamos por las dudas
    await buscarTurnoAbierto()
    return
  }
  estado.turno = r.datos
  pintarTurno()
  await cargarOrdenes()
  UI.avisar('Turno abierto', 'buena')
}

const cerrarTurno = async () => {
  await cargarOrdenes()
  const cobradas = estado.ordenes.filter((o) => o.numero > 0 && o.estado !== 'descartada')
  const porMetodo = {}
  let total = 0
  for (const o of cobradas) {
    const m = o.metodo_pago || 'efectivo'
    porMetodo[m] = (porMetodo[m] || 0) + (o.total || 0)
    total += o.total || 0
  }

  const filas = METODOS_PAGO
    .filter((m) => porMetodo[m.valor])
    .map((m) => `<div class="arqueo-fila"><span>${m.etiqueta}</span><span class="v">${plata(porMetodo[m.valor])}</span></div>`)
    .join('')

  const v = UI.modal(`
    <h2>Cerrar turno</h2>
    <p class="sub">${cobradas.length} ${cobradas.length === 1 ? 'orden cobrada' : 'órdenes cobradas'}</p>
    ${filas || '<div class="arqueo-fila"><span>Sin ventas</span><span class="v">—</span></div>'}
    <div class="arqueo-fila fuerte"><span>Total</span><span class="v">${plata(total)}</span></div>
    <p class="sub" style="margin-top:16px">
      Después de cerrar no se puede cobrar más, pero la barra sigue entregando
      lo que ya está vendido.
    </p>
    <div class="acciones-modal">
      <button class="btn" data-no>Volver</button>
      <button class="btn btn-peligro" data-si>Cerrar turno</button>
    </div>`)

  v.querySelector('[data-no]').onclick = () => v.remove()
  v.querySelector('[data-si]').onclick = async () => {
    v.remove()
    const r = await PB.pedir('PATCH', '/api/collections/turnos/records/' + estado.turno.id, {
      cerrado_at: new Date().toISOString(),
    })
    if (!r.ok) return UI.avisar(r.mensaje, 'mala')
    estado.turno = null
    vaciarCarrito()
    pintarTurno()
    await cargarOrdenes()
    UI.avisar('Turno cerrado', 'buena')
  }
}

// ── Cobrar ───────────────────────────────────────────────────

const mostrarNumero = (numero, total) => {
  const v = document.createElement('div')
  v.className = 'velo'
  v.innerHTML = `
    <div class="numerote">
      <div class="rot">Pedido</div>
      <div class="n">${numero}</div>
      <div class="det">${plata(total)}</div>
      <button class="btn btn-accion btn-grande" style="max-width:320px;margin:0 auto" data-ok>
        Siguiente pedido
      </button>
    </div>`
  document.body.appendChild(v)
  const cerrar = () => v.remove()
  v.querySelector('[data-ok]').onclick = cerrar
  // que no se quede trabada si el cajero se distrae
  setTimeout(cerrar, 25000)
}

/** Crea la orden y sus items. Devuelve el id, o null si falló. */
const crearOrden = async () => {
  const rOrden = await PB.pedir('POST', '/api/collections/ordenes/records', {
    turno_id: estado.turno.id,
    estado: 'borrador',
    cajero_id: PB.staff.id,
  })
  if (!rOrden.ok) {
    UI.avisar(rOrden.mensaje, 'mala')
    return null
  }
  const ordenId = rOrden.datos.id

  for (const l of estado.carrito) {
    const rItem = await PB.pedir('POST', '/api/collections/orden_items/records', {
      orden_id: ordenId,
      producto_id: l.producto.id,
      cantidad: l.cantidad,
      estado: 'pendiente',
    })
    if (!rItem.ok) {
      UI.avisar('No se pudo cargar ' + l.producto.nombre + ': ' + rItem.mensaje, 'mala')
      return null
    }
  }
  return ordenId
}

const cobrar = async () => {
  if (estado.cobrando || !estado.carrito.length || !estado.turno) return
  estado.cobrando = true
  pintarCarrito()

  try {
    // Si quedó un cobro a medias de un intento anterior, se retoma ese.
    let ordenId = localStorage.getItem(CLAVE_COBRO_PENDIENTE)
    if (!ordenId) {
      ordenId = await crearOrden()
      if (!ordenId) return
      localStorage.setItem(CLAVE_COBRO_PENDIENTE, ordenId)
    }

    const r = await PB.pedir('POST', '/api/tragos/cobrar', {
      orden_id: ordenId,
      metodo_pago: estado.metodoPago,
    })

    if (!r.ok) {
      // El id queda guardado: el endpoint es idempotente, reintentar es seguro.
      UI.avisar(r.mensaje + ' — tocá COBRAR de nuevo para reintentar', 'mala')
      return
    }

    localStorage.removeItem(CLAVE_COBRO_PENDIENTE)
    vaciarCarrito()
    mostrarNumero(r.datos.numero, r.datos.total)
    await cargarOrdenes()
  } finally {
    estado.cobrando = false
    pintarCarrito()
  }
}

/** Al arrancar: si quedó un cobro colgado de la sesión anterior, resolverlo. */
const resolverCobroColgado = async () => {
  const ordenId = localStorage.getItem(CLAVE_COBRO_PENDIENTE)
  if (!ordenId) return

  const r = await PB.pedir('GET', '/api/collections/ordenes/records/' + ordenId)
  if (!r.ok) {
    localStorage.removeItem(CLAVE_COBRO_PENDIENTE)
    return
  }
  const orden = r.datos

  if (orden.estado === 'cobrada') {
    localStorage.removeItem(CLAVE_COBRO_PENDIENTE)
    UI.avisar('El pedido ' + orden.numero + ' había quedado cobrado', 'buena')
    return
  }

  const seguir = await UI.confirmar({
    titulo: 'Quedó un cobro sin terminar',
    detalle: 'Un pedido quedó a medio cobrar la última vez. ¿Lo cobrás ahora o lo descartás?',
    aceptar: 'Cobrarlo',
    cancelar: 'Descartarlo',
  })

  if (seguir) {
    const c = await PB.pedir('POST', '/api/tragos/cobrar', {
      orden_id: ordenId,
      metodo_pago: 'efectivo',
    })
    if (c.ok) {
      localStorage.removeItem(CLAVE_COBRO_PENDIENTE)
      mostrarNumero(c.datos.numero, c.datos.total)
      await cargarOrdenes()
    } else {
      UI.avisar(c.mensaje, 'mala')
    }
  } else {
    await PB.pedir('PATCH', '/api/collections/ordenes/records/' + ordenId, { estado: 'descartada' })
    localStorage.removeItem(CLAVE_COBRO_PENDIENTE)
  }
}

// ── Eventos ──────────────────────────────────────────────────

const engancharEventos = () => {
  $('#tabs').onclick = (e) => {
    const b = e.target.closest('[data-cat]')
    if (!b) return
    estado.categoria = b.dataset.cat
    pintarTabs()
    pintarMenu()
  }

  $('#menu').onclick = (e) => {
    const b = e.target.closest('[data-prod]')
    if (!b) return
    const p = estado.productos.find((x) => x.id === b.dataset.prod)
    if (p) agregar(p)
  }

  $('#carrito').onclick = (e) => {
    const mas = e.target.closest('[data-mas]')
    const menos = e.target.closest('[data-menos]')
    if (mas) cambiarCantidad(mas.dataset.mas, 1)
    if (menos) cambiarCantidad(menos.dataset.menos, -1)
  }

  $('#pagos').onclick = (e) => {
    const b = e.target.closest('[data-pago]')
    if (!b) return
    estado.metodoPago = b.dataset.pago
    pintarPagos()
  }

  $('#btn-cobrar').onclick = cobrar
  $('#btn-abrir-turno').onclick = abrirTurno
  $('#btn-cerrar-turno').onclick = cerrarTurno

  $('#btn-vaciar').onclick = async () => {
    if (await UI.confirmar({ titulo: '¿Vaciar el pedido?', peligro: true, aceptar: 'Vaciar' })) {
      vaciarCarrito()
    }
  }

  $('#btn-salir').onclick = async () => {
    if (estado.carrito.length) {
      const s = await UI.confirmar({
        titulo: 'Hay un pedido sin cobrar',
        detalle: 'Si salís se pierde. ¿Seguro?',
        aceptar: 'Salir igual',
        peligro: true,
      })
      if (!s) return
    }
    PB.cerrarSesion()
    location.reload()
  }
}

// ── Arranque ─────────────────────────────────────────────────

const ROLES = ['cajero', 'jefe']

const iniciar = async () => {
  // Sesión guardada de otra pantalla del mismo dispositivo: si el rol no
  // sirve acá, se pide login de nuevo en vez de mostrar botones que fallan.
  if (PB.haySesion && !ROLES.includes(PB.staff.rol)) PB.cerrarSesion()
  if (!PB.haySesion || !(await PB.refrescar())) {
    await UI.montarLogin('Caja', ROLES)
  }

  $('#quien').textContent = PB.staff.nombre
  UI.montarConexion($('#conexion'), $('#alerta-caido'))
  engancharEventos()

  pintarTabs()
  pintarPagos()
  pintarCarrito()

  await cargarProductos()
  await buscarTurnoAbierto()
  await cargarOrdenes()
  await resolverCobroColgado()

  // La caja escucha los cambios para ver cuándo la barra marca algo listo.
  PB.escuchar(['ordenes', 'orden_items'], () => cargarOrdenes())
}

iniciar()
