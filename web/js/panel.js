/**
 * panel.js — pantalla del dueño: reportes de la noche.
 *
 * Contesta tres preguntas que pidió Alejo para su amigo:
 *   - ¿A qué hora se vendió más?
 *   - ¿Qué trago salió más esa noche?
 *   - ¿Hace cuánto que no se vende nada?
 *
 * Todo sale de datos que YA se guardaban (`ordenes.cobrada_at`,
 * `orden_items.nombre_snapshot`): no hizo falta ninguna migración.
 *
 * A propósito corre en la misma WiFi que el resto del sistema, no por
 * internet: es una pantalla más del local, no un panel en la nube. Ver
 * docs/DECISION-MULTILOCAL.md para la diferencia y por qué importa.
 */

// Si pasan más de esto sin una venta nueva (y el turno sigue abierto), avisa.
const SIN_VENTAS_AVISO_MIN = 20

const estado = {
  turnos: [],
  turnoId: null,
  ordenes: [],
  items: [],
}

const $ = (sel) => document.querySelector(sel)

// ── Datos ────────────────────────────────────────────────────

const cargarTurnos = async () => {
  estado.turnos = await PB.listar('turnos', { orden: '-abierto_at', porPagina: 30 })

  if (!estado.turnoId || !estado.turnos.some((t) => t.id === estado.turnoId)) {
    const abierto = estado.turnos.find((t) => !t.cerrado_at)
    estado.turnoId = (abierto || estado.turnos[0] || {}).id || null
  }

  pintarSelector()
}

const cargarDatosDelTurno = async () => {
  if (!estado.turnoId) {
    estado.ordenes = []
    estado.items = []
    return pintarTodo()
  }

  estado.ordenes = await PB.listar('ordenes', {
    filtro: PB.filtro({ turno_id: estado.turnoId }),
    porPagina: 500,
  })
  estado.items = await PB.listar('orden_items', {
    filtro: 'orden_id.turno_id = "' + estado.turnoId.replace(/"/g, '') + '"',
    porPagina: 500,
  })
  pintarTodo()
}

// ── Cálculos ─────────────────────────────────────────────────

const ventasCobradas = () => estado.ordenes.filter((o) => o.numero > 0)

const turnoActual = () => estado.turnos.find((t) => t.id === estado.turnoId)

const calcularResumen = () => {
  const ventas = ventasCobradas()
  const total = ventas.reduce((s, o) => s + (o.total || 0), 0)
  return { total, cantidad: ventas.length }
}

/** Suma de ventas por hora del día (0-23), redondeando por la hora de cobrada_at. */
const calcularVentaPorHora = () => {
  const porHora = {}
  for (const o of ventasCobradas()) {
    if (!o.cobrada_at) continue
    const h = new Date(String(o.cobrada_at).replace(' ', 'T')).getHours()
    porHora[h] = (porHora[h] || 0) + (o.total || 0)
  }
  return porHora
}

/** Ranking de tragos por cantidad vendida. Ignora anulados. */
const calcularRanking = () => {
  const porNombre = {}
  for (const it of estado.items) {
    if (it.estado === 'anulado') continue
    if (!it.nombre_snapshot) continue // todavía no se cobró: no cuenta como venta
    const key = it.nombre_snapshot
    if (!porNombre[key]) porNombre[key] = { nombre: key, cantidad: 0, monto: 0 }
    porNombre[key].cantidad += it.cantidad
    porNombre[key].monto += it.cantidad * (it.precio_unit || 0)
  }
  return Object.values(porNombre).sort((a, b) => b.cantidad - a.cantidad)
}

/** Minutos desde la última venta. null si el turno no tuvo ninguna venta aún. */
const minutosSinVender = () => {
  const ventas = ventasCobradas()
  if (!ventas.length) {
    const t = turnoActual()
    return t ? minutosDesde(t.abierto_at) : null
  }
  const ultima = ventas.reduce((max, o) => (o.cobrada_at > max ? o.cobrada_at : max), '')
  return minutosDesde(ultima)
}

// ── Pintado ──────────────────────────────────────────────────

const etiquetaTurno = (t) => {
  const d = new Date(String(t.abierto_at).replace(' ', 'T'))
  const fecha = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
  const hora = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  return fecha + ' ' + hora + ' — ' + (t.cerrado_at ? 'cerrado' : 'ABIERTO')
}

const pintarSelector = () => {
  const sel = $('#sel-turno')
  if (!estado.turnos.length) {
    sel.innerHTML = '<option>No hay turnos todavía</option>'
    return
  }
  sel.innerHTML = estado.turnos
    .map((t) => `<option value="${t.id}" ${t.id === estado.turnoId ? 'selected' : ''}>${UI.esc(etiquetaTurno(t))}</option>`)
    .join('')
}

const pintarAvisoSilencio = () => {
  const el = $('#aviso-silencio')
  const t = turnoActual()

  // Sólo tiene sentido avisar de un turno que sigue abierto: uno cerrado ya
  // terminó de vender, no está "en silencio".
  if (!t || t.cerrado_at) {
    el.style.display = 'none'
    return
  }

  const min = minutosSinVender()
  if (min === null || min < SIN_VENTAS_AVISO_MIN) {
    el.style.display = 'none'
    return
  }

  el.style.display = 'block'
  el.textContent = ventasCobradas().length
    ? 'No se vende nada hace ' + min + ' min'
    : 'El turno está abierto hace ' + min + ' min y todavía no hubo ninguna venta'
}

const pintarMetricas = () => {
  const { total, cantidad } = calcularResumen()
  const ranking = calcularRanking()
  const masVendido = ranking[0]

  $('#metricas').innerHTML = `
    <div class="metrica">
      <div class="n">${plata(total)}</div>
      <div class="etq">Vendido</div>
    </div>
    <div class="metrica">
      <div class="n">${cantidad}</div>
      <div class="etq">${cantidad === 1 ? 'Pedido cobrado' : 'Pedidos cobrados'}</div>
    </div>
    <div class="metrica">
      <div class="n" style="font-size:20px">${masVendido ? UI.esc(masVendido.nombre) : '—'}</div>
      <div class="etq">${masVendido ? masVendido.cantidad + ' vendidos — el que más salió' : 'Todavía nada vendido'}</div>
    </div>`
}

const pintarHoras = () => {
  const porHora = calcularVentaPorHora()
  const horas = Object.keys(porHora).map(Number).sort((a, b) => a - b)

  if (!horas.length) {
    $('#horas').innerHTML = '<div class="vacio" style="padding:20px 0">Todavía no hay ventas para graficar.</div>'
    return
  }

  const max = Math.max(...horas.map((h) => porHora[h]))
  $('#horas').innerHTML = horas.map((h) => {
    const monto = porHora[h]
    const alturaPct = max > 0 ? Math.max(4, Math.round((monto / max) * 100)) : 4
    const esPico = monto === max
    return `
      <div class="hora-col ${esPico ? 'pico' : ''}" title="${plata(monto)}">
        <div class="barra" style="height:${alturaPct}%"></div>
        <div class="etq">${String(h).padStart(2, '0')}h</div>
      </div>`
  }).join('')
}

const pintarRanking = () => {
  const ranking = calcularRanking()
  const cont = $('#ranking')

  if (!ranking.length) {
    cont.innerHTML = '<div class="vacio" style="padding:10px 0">Todavía no se vendió nada.</div>'
    return
  }

  const max = ranking[0].cantidad
  cont.innerHTML = ranking.slice(0, 10).map((r, i) => `
    <div class="ranking-fila">
      <span class="pos">${i + 1}</span>
      <div class="cuerpo">
        <div class="nom">
          <span>${UI.esc(r.nombre)}</span>
          <span class="cant">${r.cantidad}</span>
        </div>
        <div class="ranking-barra"><div style="width:${Math.round((r.cantidad / max) * 100)}%"></div></div>
      </div>
    </div>`).join('')
}

const pintarTodo = () => {
  pintarAvisoSilencio()
  pintarMetricas()
  pintarHoras()
  pintarRanking()
}

// ── Eventos ──────────────────────────────────────────────────

const engancharEventos = () => {
  $('#sel-turno').onchange = (e) => {
    estado.turnoId = e.target.value
    cargarDatosDelTurno()
  }

  $('#btn-salir').onclick = () => {
    PB.cerrarSesion()
    location.reload()
  }
}

// ── Arranque ─────────────────────────────────────────────────

const ROLES = ['jefe']

const iniciar = async () => {
  if (PB.haySesion && !ROLES.includes(PB.staff.rol)) PB.cerrarSesion()
  if (!PB.haySesion || !(await PB.refrescar())) {
    await UI.montarLogin('Panel', ROLES)
  }

  $('#quien').textContent = PB.staff.nombre
  UI.montarConexion($('#conexion'), $('#alerta-caido'))
  engancharEventos()

  await cargarTurnos()
  await cargarDatosDelTurno()

  PB.escuchar(['ordenes', 'orden_items', 'turnos'], async () => {
    await cargarTurnos()
    await cargarDatosDelTurno()
  })

  // Red de seguridad, igual que en caja/barra: si el realtime queda mudo,
  // el panel no puede quedarse mostrando una noche vieja.
  setInterval(() => cargarTurnos().then(cargarDatosDelTurno), 20000)
  // El aviso de silencio y el "hace N min" envejecen sin tocar nada.
  setInterval(pintarAvisoSilencio, 15000)
}

iniciar()
