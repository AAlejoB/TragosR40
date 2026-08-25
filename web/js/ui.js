/**
 * ui.js — piezas de interfaz que usan las dos pantallas.
 *
 * Login con teclado numérico, avisos, modales e indicador de conexión.
 * `pb.js` no toca el DOM a propósito; toda la pantalla vive acá.
 */

const UI = (() => {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  // ── Avisos flotantes ───────────────────────────────────────
  let tostadaTimer = null
  const avisar = (texto, tipo = '') => {
    document.querySelectorAll('.tostada').forEach((t) => t.remove())
    const el = document.createElement('div')
    el.className = 'tostada ' + tipo
    el.textContent = texto
    document.body.appendChild(el)
    clearTimeout(tostadaTimer)
    tostadaTimer = setTimeout(() => el.remove(), tipo === 'mala' ? 5000 : 2600)
  }

  // ── Modal genérico ─────────────────────────────────────────
  const modal = (html) => {
    const velo = document.createElement('div')
    velo.className = 'modal'
    velo.innerHTML = `<div class="modal-caja">${html}</div>`
    document.body.appendChild(velo)
    velo.addEventListener('click', (e) => { if (e.target === velo) velo.remove() })
    return velo
  }

  /** Confirmación de dos botones. Devuelve una promesa con true/false. */
  const confirmar = ({ titulo, detalle = '', aceptar = 'Sí', cancelar = 'Cancelar', peligro = false }) =>
    new Promise((resolve) => {
      const v = modal(`
        <h2>${esc(titulo)}</h2>
        ${detalle ? `<p class="sub">${esc(detalle)}</p>` : '<div style="height:10px"></div>'}
        <div class="acciones-modal">
          <button class="btn" data-no>${esc(cancelar)}</button>
          <button class="btn ${peligro ? 'btn-peligro' : 'btn-accion'}" data-si>${esc(aceptar)}</button>
        </div>`)
      v.querySelector('[data-si]').onclick = () => { v.remove(); resolve(true) }
      v.querySelector('[data-no]').onclick = () => { v.remove(); resolve(false) }
    })

  /** Pide un PIN de 4 dígitos con teclado numérico. Devuelve el PIN o null. */
  const pedirPin = ({ titulo, detalle = '' }) =>
    new Promise((resolve) => {
      const v = modal(`
        <h2>${esc(titulo)}</h2>
        ${detalle ? `<p class="sub">${esc(detalle)}</p>` : ''}
        <div class="puntos-pin" data-puntos></div>
        <div class="teclado" data-teclado></div>
        <div style="height:12px"></div>
        <div class="acciones-modal">
          <button class="btn" data-no>Cancelar</button>
        </div>`)

      let pin = ''
      const puntos = v.querySelector('[data-puntos]')
      const pintar = () => {
        puntos.innerHTML = [0, 1, 2, 3]
          .map((i) => `<div class="punto-pin ${i < pin.length ? 'lleno' : ''}"></div>`).join('')
      }
      pintar()

      const teclado = v.querySelector('[data-teclado]')
      const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']
      teclado.innerHTML = teclas
        .map((t) => (t === '' ? '<div></div>' : `<button class="tecla" data-t="${t}">${t}</button>`)).join('')

      teclado.onclick = (e) => {
        const b = e.target.closest('[data-t]')
        if (!b) return
        const t = b.dataset.t
        if (t === '⌫') pin = pin.slice(0, -1)
        else if (pin.length < 4) pin += t
        pintar()
        if (pin.length === 4) {
          setTimeout(() => { v.remove(); resolve(pin) }, 130)
        }
      }
      v.querySelector('[data-no]').onclick = () => { v.remove(); resolve(null) }
    })

  /** Elegir una opción de una lista. Devuelve el valor o null. */
  const elegir = ({ titulo, detalle = '', opciones, aceptar = 'Confirmar' }) =>
    new Promise((resolve) => {
      const v = modal(`
        <h2>${esc(titulo)}</h2>
        ${detalle ? `<p class="sub">${esc(detalle)}</p>` : ''}
        <div class="opciones" data-ops>
          ${opciones.map((o) => `<button class="opcion" data-v="${esc(o.valor)}">${esc(o.etiqueta)}</button>`).join('')}
        </div>
        <div class="acciones-modal">
          <button class="btn" data-no>Cancelar</button>
          <button class="btn btn-accion" data-si disabled>${esc(aceptar)}</button>
        </div>`)

      let elegida = null
      const btnSi = v.querySelector('[data-si]')
      v.querySelector('[data-ops]').onclick = (e) => {
        const b = e.target.closest('[data-v]')
        if (!b) return
        elegida = b.dataset.v
        v.querySelectorAll('.opcion').forEach((o) => o.classList.toggle('elegida', o === b))
        btnSi.disabled = false
      }
      btnSi.onclick = () => { v.remove(); resolve(elegida) }
      v.querySelector('[data-no]').onclick = () => { v.remove(); resolve(null) }
    })

  // ── Login ──────────────────────────────────────────────────

  /**
   * Muestra el login a pantalla completa. Resuelve cuando entró CON UN ROL
   * que sirva para esta pantalla.
   *
   * El usuario se escribe (no hay lista pública de staff: sería regalarle los
   * nombres a cualquiera conectado a la WiFi).
   *
   * `rolesOk` evita que un cajero quede operando la barra: el servidor igual
   * lo rechazaría, pero la pantalla no tiene por qué ofrecer botones que van
   * a fallar.
   */
  const montarLogin = (pantalla, rolesOk) =>
    new Promise((resolve) => {
      const v = document.createElement('div')
      v.className = 'login'
      v.innerHTML = `
        <div class="login-caja">
          <h1>${esc(pantalla)}</h1>
          <p class="sub">Entrá con tu usuario y PIN</p>
          <input class="campo" data-usuario placeholder="usuario"
                 autocapitalize="none" autocorrect="off" spellcheck="false">
          <div class="puntos-pin" data-puntos></div>
          <div class="error" data-error></div>
          <div class="teclado" data-teclado></div>
        </div>`
      document.body.appendChild(v)

      const inpUsuario = v.querySelector('[data-usuario]')
      const puntos = v.querySelector('[data-puntos]')
      const error = v.querySelector('[data-error]')
      let pin = ''
      let ocupado = false

      const pintar = () => {
        puntos.innerHTML = [0, 1, 2, 3]
          .map((i) => `<div class="punto-pin ${i < pin.length ? 'lleno' : ''}"></div>`).join('')
      }
      pintar()
      setTimeout(() => inpUsuario.focus(), 60)

      const intentar = async () => {
        const usuario = inpUsuario.value.trim().toLowerCase()
        if (!usuario) {
          error.textContent = 'Escribí tu usuario'
          pin = ''
          pintar()
          return
        }
        ocupado = true
        error.textContent = ''
        const r = await PB.entrar(usuario, pin)
        ocupado = false
        if (!r.ok) {
          error.textContent = r.mensaje
          pin = ''
          pintar()
          return
        }
        if (rolesOk && !rolesOk.includes(r.staff.rol)) {
          error.textContent = 'Tu usuario es de ' + r.staff.rol + ', no entra acá'
          PB.cerrarSesion()
          pin = ''
          pintar()
          return
        }
        v.remove()
        resolve(r.staff)
      }

      const teclado = v.querySelector('[data-teclado]')
      teclado.innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']
        .map((t) => (t === '' ? '<div></div>' : `<button class="tecla" data-t="${t}">${t}</button>`)).join('')

      teclado.onclick = (e) => {
        const b = e.target.closest('[data-t]')
        if (!b || ocupado) return
        const t = b.dataset.t
        if (t === '⌫') pin = pin.slice(0, -1)
        else if (pin.length < 4) pin += t
        pintar()
        if (pin.length === 4) setTimeout(intentar, 120)
      }

      // teclado físico, por si la tablet tiene uno o se prueba en la notebook
      v.addEventListener('keydown', (e) => {
        if (ocupado) return
        if (e.key >= '0' && e.key <= '9' && document.activeElement !== inpUsuario) {
          if (pin.length < 4) pin += e.key
          pintar()
          if (pin.length === 4) setTimeout(intentar, 120)
        } else if (e.key === 'Backspace' && document.activeElement !== inpUsuario) {
          pin = pin.slice(0, -1)
          pintar()
        } else if (e.key === 'Enter' && pin.length === 4) {
          intentar()
        }
      })
    })

  // ── Indicador de conexión ──────────────────────────────────

  /**
   * Engancha el punto verde/rojo y la franja de alerta.
   * La franja importa: si el server se cayó, el cajero tiene que enterarse
   * en el momento para pasar al talonario, no cuando no cierre el arqueo.
   */
  const montarConexion = (elPunto, elAlerta) => {
    const pintar = (ok) => {
      if (elPunto) {
        elPunto.classList.toggle('caido', !ok)
        const txt = elPunto.querySelector('[data-txt]')
        if (txt) txt.textContent = ok ? 'Conectado' : 'Sin conexión'
      }
      if (elAlerta) elAlerta.style.display = ok ? 'none' : 'block'
    }
    pintar(PB.conectado)
    PB.alCambiarConexion(pintar)
    PB.vigilarConexion()
  }

  return { esc, avisar, modal, confirmar, pedirPin, elegir, montarLogin, montarConexion }
})()
