/**
 * gestion.js — pantalla del jefe: el menú.
 *
 * Existe para que el dueño no tenga que entrar al panel técnico de PocketBase,
 * donde con dos clics se rompe el sistema sin querer.
 *
 * Lo que se puede hacer acá: agregar tragos, cambiar precios, reordenar y
 * apagar un producto cuando se acaba. Lo que NO: borrar. Un producto borrado
 * dejaría huérfanas las ventas viejas que lo referencian, así que el schema lo
 * prohíbe para todos (`deleteRule: null`). Se apaga, no se borra.
 */

const estado = {
  productos: [],
  categoria: 'trago',
}

const $ = (sel) => document.querySelector(sel)

// ── Datos ────────────────────────────────────────────────────

const cargar = async () => {
  estado.productos = await PB.listar('productos', { orden: 'orden,nombre', porPagina: 300 })
  pintar()
}

const deCategoria = () =>
  estado.productos
    .filter((p) => p.categoria === estado.categoria)
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))

// ── Pintado ──────────────────────────────────────────────────

const pintarTabs = () => {
  $('#tabs').innerHTML = CATEGORIAS.map((c) => {
    const n = estado.productos.filter((p) => p.categoria === c.valor).length
    const apagados = estado.productos.filter((p) => p.categoria === c.valor && !p.activo).length
    return `<button class="tab ${c.valor === estado.categoria ? 'activa' : ''}" data-cat="${c.valor}">
      ${UI.esc(c.etiqueta)} ${n}${apagados ? ' · ' + apagados + ' off' : ''}
    </button>`
  }).join('')
}

const pintarLista = () => {
  const lista = deCategoria()
  const cont = $('#lista')

  if (!lista.length) {
    cont.innerHTML = '<div class="vacio">No hay nada en esta categoría.<br>Tocá "+ Agregar" para sumar el primero.</div>'
    return
  }

  cont.innerHTML = lista.map((p, i) => `
    <div class="fila-prod ${p.activo ? '' : 'apagado'}">
      <div class="mover">
        <button data-sube="${p.id}" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>▲</button>
        <button data-baja="${p.id}" ${i === lista.length - 1 ? 'disabled style="opacity:.25"' : ''}>▼</button>
      </div>
      <button class="datos" style="text-align:left;flex:1" data-editar="${p.id}">
        <div class="nom">${UI.esc(p.nombre)}</div>
        <div class="pre ${p.activo ? '' : 'apagado'}">${plata(p.precio)}${p.activo ? '' : ' · se acabó'}</div>
      </button>
      <button class="switch ${p.activo ? 'si' : ''}" data-toggle="${p.id}"
              title="${p.activo ? 'Tocá para marcar que se acabó' : 'Tocá para volver a venderlo'}"></button>
    </div>`).join('')
}

const pintar = () => {
  pintarTabs()
  pintarLista()
}

// ── Acciones ─────────────────────────────────────────────────

/** Un toque. Sin confirmación: se usa a las 3am cuando se acabó la ginebra. */
const alternarActivo = async (id) => {
  const p = estado.productos.find((x) => x.id === id)
  if (!p) return

  // Optimista: la pantalla responde al toque, el server confirma después.
  p.activo = !p.activo
  pintar()

  const r = await PB.pedir('PATCH', '/api/collections/productos/records/' + id, { activo: p.activo })
  if (!r.ok) {
    p.activo = !p.activo
    pintar()
    return UI.avisar(r.mensaje, 'mala')
  }
  UI.avisar(p.activo ? UI.esc(p.nombre) + ' vuelve al menú' : UI.esc(p.nombre) + ' marcado como agotado', 'buena')
}

const mover = async (id, delta) => {
  const lista = deCategoria()
  const i = lista.findIndex((p) => p.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= lista.length) return

  const a = lista[i]
  const b = lista[j]
  const ordenA = a.orden || 0
  const ordenB = b.orden || 0

  // Si vinieran con el mismo `orden` (seed viejo), reescribimos toda la
  // categoría de 1 a N antes de intercambiar. Si no, el swap no haría nada.
  if (ordenA === ordenB) {
    for (let k = 0; k < lista.length; k++) {
      lista[k].orden = k + 1
      await PB.pedir('PATCH', '/api/collections/productos/records/' + lista[k].id, { orden: k + 1 })
    }
    pintar()
    return mover(id, delta)
  }

  a.orden = ordenB
  b.orden = ordenA
  pintar()

  const r1 = await PB.pedir('PATCH', '/api/collections/productos/records/' + a.id, { orden: ordenB })
  const r2 = await PB.pedir('PATCH', '/api/collections/productos/records/' + b.id, { orden: ordenA })
  if (!r1.ok || !r2.ok) {
    UI.avisar('No se pudo reordenar', 'mala')
    await cargar()
  }
}

const formulario = (producto) => {
  const esNuevo = !producto
  const p = producto || { nombre: '', precio: '', categoria: estado.categoria, activo: true }

  const v = UI.modal(`
    <h2>${esNuevo ? 'Agregar al menú' : 'Editar'}</h2>
    <div style="height:14px"></div>

    <label class="etiqueta-campo">Nombre</label>
    <input class="campo-form" data-nombre maxlength="60" value="${UI.esc(p.nombre)}"
           placeholder="Fernet con Coca" autocapitalize="words">

    <label class="etiqueta-campo">Precio</label>
    <input class="campo-form" data-precio type="number" inputmode="numeric" min="0" step="100"
           value="${p.precio}" placeholder="8000">

    <label class="etiqueta-campo">Categoría</label>
    <div class="elegir-cat" data-cats>
      ${CATEGORIAS.map((c) => `<button data-c="${c.valor}" class="${c.valor === p.categoria ? 'elegida' : ''}">${UI.esc(c.etiqueta)}</button>`).join('')}
    </div>

    ${esNuevo ? '' : `
      <div class="nota-precio">
        Cambiar el precio <strong>no toca los pedidos ya cobrados</strong>: cada
        venta se guarda con el precio que tenía en ese momento. Podés subirlo a
        mitad de la noche sin que se descuadre el arqueo.
      </div>`}

    <div class="error" data-error></div>
    <div class="acciones-modal">
      <button class="btn" data-no>Cancelar</button>
      <button class="btn btn-accion" data-si>${esNuevo ? 'Agregar' : 'Guardar'}</button>
    </div>`)

  let categoria = p.categoria
  v.querySelector('[data-cats]').onclick = (e) => {
    const b = e.target.closest('[data-c]')
    if (!b) return
    categoria = b.dataset.c
    v.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('elegida', x === b))
  }

  v.querySelector('[data-no]').onclick = () => v.remove()
  v.querySelector('[data-si]').onclick = async () => {
    const nombre = v.querySelector('[data-nombre]').value.trim()
    const precio = Number(v.querySelector('[data-precio]').value)
    const error = v.querySelector('[data-error]')

    if (!nombre) return (error.textContent = 'Poné un nombre')
    if (!precio || precio <= 0) return (error.textContent = 'Poné un precio mayor a cero')

    const cuerpo = { nombre, precio, categoria }

    let r
    if (esNuevo) {
      const mismaCat = estado.productos.filter((x) => x.categoria === categoria)
      cuerpo.orden = mismaCat.reduce((m, x) => Math.max(m, x.orden || 0), 0) + 1
      cuerpo.activo = true
      r = await PB.pedir('POST', '/api/collections/productos/records', cuerpo)
    } else {
      r = await PB.pedir('PATCH', '/api/collections/productos/records/' + p.id, cuerpo)
    }

    if (!r.ok) return (error.textContent = r.mensaje)

    v.remove()
    estado.categoria = categoria
    await cargar()
    UI.avisar(esNuevo ? 'Agregado al menú' : 'Guardado', 'buena')
  }

  setTimeout(() => v.querySelector('[data-nombre]').focus(), 80)
}

// ── Eventos ──────────────────────────────────────────────────

const engancharEventos = () => {
  $('#tabs').onclick = (e) => {
    const b = e.target.closest('[data-cat]')
    if (!b) return
    estado.categoria = b.dataset.cat
    pintar()
  }

  $('#lista').onclick = (e) => {
    const t = e.target.closest('[data-toggle]')
    const ed = e.target.closest('[data-editar]')
    const su = e.target.closest('[data-sube]')
    const ba = e.target.closest('[data-baja]')
    if (t) return alternarActivo(t.dataset.toggle)
    if (su) return mover(su.dataset.sube, -1)
    if (ba) return mover(ba.dataset.baja, 1)
    if (ed) return formulario(estado.productos.find((p) => p.id === ed.dataset.editar))
  }

  $('#btn-nuevo').onclick = () => formulario(null)

  $('#btn-salir').onclick = () => {
    PB.cerrarSesion()
    location.reload()
  }
}

// ── Arranque ─────────────────────────────────────────────────

const ROLES = ['jefe']

const iniciar = async () => {
  // Sólo el jefe. El server ya rechaza a los demás (createRule/updateRule de
  // productos son `rol = "jefe"`), pero no hay que mostrar una pantalla entera
  // de botones que van a fallar.
  if (PB.haySesion && !ROLES.includes(PB.staff.rol)) PB.cerrarSesion()
  if (!PB.haySesion || !(await PB.refrescar())) {
    await UI.montarLogin('Menú', ROLES)
  }

  $('#quien').textContent = PB.staff.nombre
  UI.montarConexion($('#conexion'), $('#alerta-caido'))
  engancharEventos()

  await cargar()

  // Si otro dispositivo toca el menú, esta pantalla se entera.
  PB.escuchar(['productos'], () => cargar())
  setInterval(cargar, 30000)
}

iniciar()
