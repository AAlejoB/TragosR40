/**
 * pb.js — cliente de PocketBase escrito a mano.
 *
 * Por qué no el SDK oficial: viene por CDN, y el local no tiene internet.
 * Todo lo que se necesita entra en este archivo.
 *
 * Las páginas se sirven desde el propio PocketBase (--publicDir), así que la
 * API está en el mismo origen y no hace falta configurar ninguna IP.
 */

const PB = (() => {
  const BASE = ''

  // Una sesión por pantalla, no una por dispositivo: si caja y barra comparten
  // la misma clave, abrir una desloguea la otra. En el local son tablets
  // distintas, pero durante las pruebas (y si algún día alguien usa las dos en
  // el mismo aparato) esto evita un problema que se ve rarísimo.
  const CLAVE_SESION = 'tragos_sesion_' +
    (location.pathname.split('/').pop() || 'index').replace('.html', '')

  let sesion = null
  try {
    sesion = JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null')
  } catch (err) {
    sesion = null
  }

  // ── Conexión ───────────────────────────────────────────────
  let conectado = true
  const oyentesConexion = []

  const marcarConexion = (ok) => {
    if (conectado === ok) return
    conectado = ok
    oyentesConexion.forEach((fn) => fn(ok))
  }

  // ── Peticiones ─────────────────────────────────────────────

  /**
   * Devuelve {ok, status, datos, mensaje}. Nunca tira por un 4xx: la caja no
   * puede quedarse con una pantalla en blanco por un error de validación.
   */
  const pedir = async (metodo, ruta, cuerpo) => {
    const headers = { 'Content-Type': 'application/json' }
    if (sesion && sesion.token) headers.Authorization = sesion.token

    let res
    try {
      res = await fetch(BASE + ruta, {
        method: metodo,
        headers,
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      })
    } catch (err) {
      marcarConexion(false)
      return { ok: false, status: 0, datos: null, mensaje: 'Sin conexión con el servidor' }
    }

    marcarConexion(true)

    const texto = await res.text()
    let datos = null
    if (texto) {
      try {
        datos = JSON.parse(texto)
      } catch (err) {
        datos = null
      }
    }

    if (res.status === 401 && sesion) {
      // el token venció: hay que volver a entrar
      cerrarSesion()
      return { ok: false, status: 401, datos: null, mensaje: 'La sesión venció, entrá de nuevo' }
    }

    if (!res.ok) {
      let mensaje = (datos && datos.message) || 'Error ' + res.status
      // PocketBase mete el detalle util adentro de data
      if (datos && datos.data) {
        const campos = Object.keys(datos.data)
        if (campos.length) {
          const primero = datos.data[campos[0]]
          if (primero && primero.message) mensaje = campos[0] + ': ' + primero.message
        }
      }
      return { ok: false, status: res.status, datos, mensaje }
    }

    return { ok: true, status: res.status, datos, mensaje: '' }
  }

  const filtro = (obj) => {
    const partes = []
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || v === null) continue
      partes.push(`${k}="${String(v).replace(/"/g, '\\"')}"`)
    }
    return partes.join(' && ')
  }

  /** Trae registros de una colección. Devuelve [] si algo falla. */
  const listar = async (coleccion, opciones = {}) => {
    const params = new URLSearchParams()
    params.set('perPage', String(opciones.porPagina || 200))
    if (opciones.filtro) params.set('filter', opciones.filtro)
    if (opciones.orden) params.set('sort', opciones.orden)
    if (opciones.expandir) params.set('expand', opciones.expandir)
    const r = await pedir('GET', `/api/collections/${coleccion}/records?${params}`)
    return r.ok && r.datos ? r.datos.items : []
  }

  // ── Sesión ─────────────────────────────────────────────────

  const entrar = async (usuario, pin) => {
    const r = await pedir('POST', '/api/collections/staff/auth-with-password', {
      identity: usuario,
      password: pin,
    })
    if (!r.ok) {
      // 400 acá es "usuario o PIN incorrecto"; no exponemos cuál de los dos
      return { ok: false, mensaje: r.status === 400 ? 'Usuario o PIN incorrecto' : r.mensaje }
    }
    sesion = { token: r.datos.token, staff: r.datos.record }
    localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion))
    return { ok: true, staff: sesion.staff }
  }

  const cerrarSesion = () => {
    sesion = null
    localStorage.removeItem(CLAVE_SESION)
  }

  /** Revalida el token guardado contra el server. */
  const refrescar = async () => {
    if (!sesion) return false
    const r = await pedir('POST', '/api/collections/staff/auth-refresh')
    if (!r.ok) {
      if (r.status === 0) return true // sin red: confiamos en lo guardado
      cerrarSesion()
      return false
    }
    sesion = { token: r.datos.token, staff: r.datos.record }
    localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion))
    return true
  }

  // ── Realtime (SSE) con reintento y respaldo por sondeo ──────

  /**
   * Se suscribe a los cambios de unas colecciones.
   * `alCambiar` se llama sin argumentos: la pantalla vuelve a pedir lo que
   * necesita. Es más simple que aplicar diffs, y a esta escala no se nota.
   *
   * Si el SSE no levanta, cae a sondeo cada 3 segundos. La barra tiene que
   * seguir andando aunque el navegador viejo de una tablet no soporte SSE.
   */
  const escuchar = (colecciones, alCambiar) => {
    let fuente = null
    let sondeo = null
    let vivo = true
    let reintento = 1000

    const arrancarSondeo = () => {
      if (sondeo) return
      sondeo = setInterval(() => alCambiar(), 3000)
    }
    const pararSondeo = () => {
      if (!sondeo) return
      clearInterval(sondeo)
      sondeo = null
    }

    const conectar = () => {
      if (!vivo) return
      try {
        fuente = new EventSource(BASE + '/api/realtime')
      } catch (err) {
        arrancarSondeo()
        return
      }

      fuente.addEventListener('PB_CONNECT', async (ev) => {
        let clientId = null
        try {
          clientId = JSON.parse(ev.data).clientId
        } catch (err) {
          return
        }
        // La auth del realtime NO va en el EventSource (no admite headers):
        // va en este POST, atado al clientId.
        const r = await pedir('POST', '/api/realtime', {
          clientId,
          subscriptions: colecciones,
        })
        if (r.ok) {
          reintento = 1000
          pararSondeo()
          marcarConexion(true)
          alCambiar()
        } else {
          arrancarSondeo()
        }
      })

      for (const col of colecciones) {
        fuente.addEventListener(col, () => alCambiar())
      }

      fuente.onerror = () => {
        marcarConexion(false)
        arrancarSondeo()
        if (fuente) {
          fuente.close()
          fuente = null
        }
        if (!vivo) return
        setTimeout(conectar, reintento)
        reintento = Math.min(reintento * 2, 15000)
      }
    }

    conectar()

    return () => {
      vivo = false
      pararSondeo()
      if (fuente) fuente.close()
    }
  }

  /** Latido: detecta que el server volvió aunque no haya movimiento. */
  const vigilarConexion = () => {
    setInterval(async () => {
      try {
        const res = await fetch(BASE + '/api/health', { cache: 'no-store' })
        marcarConexion(res.ok)
      } catch (err) {
        marcarConexion(false)
      }
    }, 5000)
  }

  return {
    get staff() { return sesion ? sesion.staff : null },
    get haySesion() { return !!sesion },
    get conectado() { return conectado },
    entrar,
    cerrarSesion,
    refrescar,
    pedir,
    listar,
    filtro,
    escuchar,
    vigilarConexion,
    alCambiarConexion: (fn) => oyentesConexion.push(fn),
  }
})()
