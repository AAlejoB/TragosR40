/**
 * barra.js — pantalla del barman.
 *
 * Tablero de tres pistas: COLA → PREPARANDO → LISTOS.
 * Agrupado por número de pedido, porque un pedido de 4 tragos lo hace una
 * persona sola y conviene verlo junto.
 *
 * El barman nunca ve un `borrador`: eso lo filtra el servidor, no esta pantalla.
 */

const estado = {
  turno: null,
  items: [],
  ordenes: {},   // id -> orden
  cargando: false,
  ultimaCarga: 0,   // cuándo trajimos datos del server por última vez
}

const $ = (sel) => document.querySelector(sel)
const yo = () => PB.staff.id

// ── Datos ────────────────────────────────────────────────────

const buscarTurnoAbierto = async () => {
  const abiertos = await PB.listar('turnos', { filtro: 'cerrado_at = null', orden: '-abierto_at' })
  estado.turno = abiertos[0] || null
}

const cargar = async () => {
  if (estado.cargando) return
  estado.cargando = true
  try {
    if (!estado.turno) await buscarTurnoAbierto()

    // Sin turno abierto igual puede quedar trabajo del turno que se cerró:
    // cerrar el turno bloquea cobrar, no entregar.
    const base = '(estado = "pendiente" || estado = "preparando" || estado = "listo")'
    const filtro = estado.turno
      ? `orden_id.turno_id = "${estado.turno.id}" && ${base}`
      : base

    const items = await PB.listar('orden_items', {
      filtro,
      orden: 'created_at',
      expandir: 'orden_id',
      porPagina: 300,
    })

    estado.items = items
    estado.ultimaCarga = Date.now()
    estado.ordenes = {}
    for (const it of items) {
      const o = it.expand && it.expand.orden_id
      if (o) estado.ordenes[o.id] = o
    }
    pintar()
  } finally {
    estado.cargando = false
  }
}

// ── Agrupado ─────────────────────────────────────────────────

const agrupar = (items) => {
  const grupos = new Map()
  for (const it of items) {
    const o = estado.ordenes[it.orden_id]
    const clave = it.orden_id
    if (!grupos.has(clave)) {
      grupos.set(clave, { orden: o, items: [] })
    }
    grupos.get(clave).items.push(it)
  }
  // el pedido que espera hace más rato, primero
  return [...grupos.values()].sort((a, b) => {
    const ta = a.orden ? a.orden.cobrada_at : ''
    const tb = b.orden ? b.orden.cobrada_at : ''
    return String(ta).localeCompare(String(tb))
  })
}

const nombreDe = (it) => it.nombre_snapshot || '(trago)'

// ── Pintado ──────────────────────────────────────────────────

const pintarCola = () => {
  const pendientes = estado.items.filter((i) => i.estado === 'pendiente')
  $('#n-cola').textContent = pendientes.length

  const cont = $('#cola')
  const grupos = agrupar(pendientes)
  if (!grupos.length) {
    cont.innerHTML = '<div class="vacio">No hay tragos esperando.</div>'
    return
  }

  cont.innerHTML = grupos.map((g) => {
    const num = g.orden ? g.orden.numero : '—'
    const espera = g.orden ? desdeHace(g.orden.cobrada_at) : ''
    const min = g.orden ? minutosDesde(g.orden.cobrada_at) : 0
    const varios = g.items.length > 1
    return `
      <div class="grupo">
        <div class="grupo-cab">
          <span class="num">${num}</span>
          <span class="tiempo ${min >= 5 ? 'tarde' : ''}">${espera}</span>
        </div>
        ${agruparIguales(g.items).map((gi) => `
          <button class="trago" data-claim="${gi.items.map((x) => x.id).join(',')}">
            <span class="cantidad">${gi.items.length}×</span>
            <span class="nombre">${UI.esc(gi.nombre)}</span>
            <span class="btn btn-chico btn-accion">Tomar</span>
          </button>`).join('')}
        ${varios ? `
          <div class="acciones-trago">
            <button class="btn btn-chico" data-claim-todo="${g.orden ? g.orden.id : ''}">
              Tomar los ${g.items.length} tragos
            </button>
          </div>` : ''}
      </div>`
  }).join('')
}

const pintarPreparando = () => {
  const preparando = estado.items.filter((i) => i.estado === 'preparando')
  const mios = preparando.filter((i) => i.barman_id === yo())
  const ajenos = preparando.filter((i) => i.barman_id !== yo())
  $('#n-prep').textContent = mios.length

  const cont = $('#preparando')
  if (!preparando.length) {
    cont.innerHTML = '<div class="vacio">No estás preparando nada.</div>'
    return
  }

  const pintarGrupo = (g, propio) => {
    const num = g.orden ? g.orden.numero : '—'
    return `
      <div class="grupo" style="${propio ? '' : 'opacity:.5'}">
        <div class="grupo-cab">
          <span class="num">${num}</span>
          ${propio ? '' : '<span class="tiempo">otro barman</span>'}
        </div>
        ${g.items.map((it) => {
          const min = minutosDesde(it.claim_at)
          const cerca = min >= TIMEOUT_CLAIM_MIN - 2
          return `
            <div class="trago">
              <span class="nombre">${UI.esc(nombreDe(it))}</span>
              <span class="tiempo ${cerca ? 'tarde' : ''}">${desdeHace(it.claim_at)}</span>
            </div>
            ${propio ? `
              <div class="acciones-trago">
                <button class="btn btn-chico" data-anular="${it.id}">Anular</button>
                <button class="btn btn-chico btn-ok" data-listo="${it.id}">Listo</button>
              </div>` : ''}
            ${cerca && propio ? `
              <div class="aviso-timeout">
                Si no lo marcás listo vuelve solo a la cola a los ${TIMEOUT_CLAIM_MIN} min
              </div>` : ''}`
        }).join('')}
      </div>`
  }

  cont.innerHTML =
    agrupar(mios).map((g) => pintarGrupo(g, true)).join('') +
    agrupar(ajenos).map((g) => pintarGrupo(g, false)).join('')
}

const pintarListos = () => {
  const listos = estado.items.filter((i) => i.estado === 'listo')
  $('#n-listos').textContent = listos.length

  const cont = $('#listos')
  const grupos = agrupar(listos)
  if (!grupos.length) {
    cont.innerHTML = '<div class="vacio">Nada esperando que lo retiren.</div>'
    return
  }

  cont.innerHTML = grupos.map((g) => {
    const num = g.orden ? g.orden.numero : '—'
    const todosListos = g.orden && estado.items
      .filter((i) => i.orden_id === g.orden.id)
      .every((i) => i.estado === 'listo')
    return `
      <div class="grupo">
        <div class="grupo-cab">
          <span class="num">${num}</span>
          ${todosListos ? '<span class="pill lista">pedido completo</span>' : ''}
          <span class="tiempo">${g.orden ? desdeHace(g.orden.cobrada_at) : ''}</span>
        </div>
        ${g.items.map((it) => `
          <div class="trago">
            <span class="nombre">${UI.esc(nombreDe(it))}</span>
          </div>
          <div class="acciones-trago">
            <button class="btn btn-chico" data-anular="${it.id}">Anular</button>
            <button class="btn btn-chico btn-accion" data-entregar="${it.id}">Entregar</button>
          </div>`).join('')}
        ${g.items.length > 1 ? `
          <div class="acciones-trago">
            <button class="btn btn-chico btn-accion" data-entregar-todo="${g.orden ? g.orden.id : ''}">
              Entregar el pedido completo
            </button>
          </div>` : ''}
      </div>`
  }).join('')
}

/**
 * Cuán vieja está la pantalla. Se muestra siempre, no sólo cuando falla:
 * el barman tiene que poder MIRAR y saber si lo que ve es de ahora.
 * Si dice más de 30 segundos, algo anda mal aunque el punto esté verde.
 */
const pintarFrescura = () => {
  const el = $('#frescura')
  if (!el) return
  const seg = Math.floor((Date.now() - estado.ultimaCarga) / 1000)
  const txt = el.querySelector('[data-txt]')
  if (!estado.ultimaCarga) {
    txt.textContent = 'sin datos'
  } else if (seg < 20) {
    txt.textContent = 'al día'
  } else {
    txt.textContent = 'hace ' + (seg < 60 ? seg + ' s' : Math.floor(seg / 60) + ' min')
  }
  el.classList.toggle('caido', estado.ultimaCarga > 0 && seg > 30)
}

const pintar = () => {
  pintarCola()
  pintarPreparando()
  pintarListos()
  pintarFrescura()
  $('#sin-turno').style.display = estado.turno ? 'none' : 'block'
}

// ── Acciones ─────────────────────────────────────────────────

/**
 * Toma uno o varios tragos iguales del mismo pedido.
 *
 * [PODA] Tras sacar `cantidad`, "3× Fernet" son 3 registros. El botón toma
 * los tres de una: un barman que hace 3 Fernet los hace juntos. Que sean
 * registros separados sigue importando — se pueden marcar listos o anular de
 * a uno si hace falta.
 */
const tomar = async (ids) => {
  const lista = String(ids).split(',').filter(Boolean)
  let tomados = 0
  let ultimoMensaje = ''
  let ultimoStatus = 0

  for (const id of lista) {
    const r = await PB.pedir('POST', '/api/tragos/claim', { item_id: id })
    if (r.ok) tomados++
    else {
      ultimoMensaje = r.mensaje
      ultimoStatus = r.status
    }
  }

  if (tomados === 0 && ultimoMensaje) {
    // 409 = lo agarró otro primero. No es un error del barman.
    UI.avisar(ultimoMensaje, ultimoStatus === 409 ? '' : 'mala')
  } else if (tomados < lista.length) {
    UI.avisar(`Tomaste ${tomados} de ${lista.length}: otro barman se adelantó`, '')
  }
  await cargar()
}

const tomarTodo = async (ordenId) => {
  const pendientes = estado.items.filter((i) => i.orden_id === ordenId && i.estado === 'pendiente')
  let tomados = 0
  for (const it of pendientes) {
    const r = await PB.pedir('POST', '/api/tragos/claim', { item_id: it.id })
    if (r.ok) tomados++
  }
  if (tomados < pendientes.length) {
    UI.avisar(`Tomaste ${tomados} de ${pendientes.length}: otro barman se adelantó`, '')
  }
  await cargar()
}

const marcar = async (itemId, nuevoEstado) => {
  const r = await PB.pedir('PATCH', '/api/collections/orden_items/records/' + itemId, {
    estado: nuevoEstado,
  })
  if (!r.ok) UI.avisar(r.mensaje, 'mala')
  await cargar()
}

const entregarTodo = async (ordenId) => {
  const listos = estado.items.filter((i) => i.orden_id === ordenId && i.estado === 'listo')
  for (const it of listos) {
    await PB.pedir('PATCH', '/api/collections/orden_items/records/' + it.id, { estado: 'entregado' })
  }
  await cargar()
}

const anular = async (itemId) => {
  const item = estado.items.find((i) => i.id === itemId)
  if (!item) return

  const motivo = await UI.elegir({
    titulo: 'Anular ' + nombreDe(item),
    detalle: 'Queda registrado con tu nombre y el motivo. No se puede deshacer.',
    opciones: MOTIVOS_ANULAR,
    aceptar: 'Anular',
  })
  if (!motivo) return

  const cuerpo = { item_id: itemId, motivo }

  // Anular algo ya entregado es tocar plata cobrada: lo autoriza el jefe.
  if (item.estado === 'entregado') {
    const pin = await UI.pedirPin({
      titulo: 'PIN del jefe',
      detalle: 'Este trago ya se entregó. Anularlo necesita autorización.',
    })
    if (!pin) return
    cuerpo.pin_jefe = pin
  }

  const r = await PB.pedir('POST', '/api/tragos/anular', cuerpo)
  if (!r.ok) UI.avisar(r.mensaje, 'mala')
  else UI.avisar('Anulado', 'buena')
  await cargar()
}

// ── Eventos ──────────────────────────────────────────────────

const engancharEventos = () => {
  document.addEventListener('click', (e) => {
    const claim = e.target.closest('[data-claim]')
    const claimTodo = e.target.closest('[data-claim-todo]')
    const listo = e.target.closest('[data-listo]')
    const entregar = e.target.closest('[data-entregar]')
    const entregarT = e.target.closest('[data-entregar-todo]')
    const anu = e.target.closest('[data-anular]')

    if (anu) return anular(anu.dataset.anular)
    if (claimTodo) return tomarTodo(claimTodo.dataset.claimTodo)
    if (claim) return tomar(claim.dataset.claim)
    if (listo) return marcar(listo.dataset.listo, 'listo')
    if (entregarT) return entregarTodo(entregarT.dataset.entregarTodo)
    if (entregar) return marcar(entregar.dataset.entregar, 'entregado')
  })

  $('#btn-salir').onclick = () => {
    PB.cerrarSesion()
    location.reload()
  }
}

// ── Arranque ─────────────────────────────────────────────────

const ROLES = ['barman', 'jefe']

const iniciar = async () => {
  // Un cajero no opera la barra: el server lo rechazaría igual, pero no hay
  // que ofrecerle botones que van a dar 403.
  if (PB.haySesion && !ROLES.includes(PB.staff.rol)) PB.cerrarSesion()
  if (!PB.haySesion || !(await PB.refrescar())) {
    await UI.montarLogin('Barra', ROLES)
  }

  $('#quien').textContent = PB.staff.nombre
  UI.montarConexion($('#conexion'), $('#alerta-caido'))
  engancharEventos()

  await cargar()

  PB.escuchar(['ordenes', 'orden_items'], () => cargar())

  // RED DE SEGURIDAD. El realtime puede quedar "zombi": la conexión sigue
  // abierta, no salta ningún error, pero dejan de llegar avisos. Sin esto, la
  // barra mostraría una cola vieja para siempre y nadie se enteraría. Es el
  // caso que más duele: un trago pagado que nadie prepara.
  setInterval(cargar, 15000)

  // Los "hace N min", el aviso de timeout y el indicador de frescura.
  setInterval(pintar, 5000)
  // El turno puede cambiar sin que se toque un item.
  setInterval(() => buscarTurnoAbierto().then(pintar), 60000)
}

iniciar()
