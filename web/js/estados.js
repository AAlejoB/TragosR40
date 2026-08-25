/**
 * estados.js — la máquina de estados, del lado de la pantalla.
 *
 * OJO: esto es un espejo de lo que valida el servidor (`pb/pb_hooks/`), NO la
 * fuente de verdad. Sirve para no mostrar botones que van a ser rechazados.
 * Si cambia una transición allá, hay que cambiarla acá también.
 */

const ESTADOS_ORDEN = ['borrador', 'cobrada', 'en_preparacion', 'lista', 'entregada', 'descartada']
const ESTADOS_ITEM = ['pendiente', 'preparando', 'listo', 'entregado', 'anulado']

const TRANSICIONES_ITEM = {
  pendiente: ['preparando'],
  preparando: ['listo'],
  listo: ['entregado'],
  entregado: [],
  anulado: [],
}

const MOTIVOS_ANULAR = [
  { valor: 'se_cayo', etiqueta: 'Se cayó' },
  { valor: 'cliente_se_fue', etiqueta: 'El cliente se fue' },
  { valor: 'error_carga', etiqueta: 'Error de carga' },
  { valor: 'sin_stock', etiqueta: 'Sin stock' },
  { valor: 'otro', etiqueta: 'Otro' },
]

const CATEGORIAS = [
  { valor: 'trago', etiqueta: 'Tragos' },
  { valor: 'cerveza', etiqueta: 'Cervezas' },
  { valor: 'shot', etiqueta: 'Shots' },
  { valor: 'sin_alcohol', etiqueta: 'Sin alcohol' },
]

const METODOS_PAGO = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'tarjeta', etiqueta: 'Tarjeta' },
  { valor: 'transferencia', etiqueta: 'Transfer' },
]

const ETIQUETAS_ORDEN = {
  borrador: 'Borrador',
  cobrada: 'Cobrada',
  en_preparacion: 'En preparación',
  lista: 'Lista',
  entregada: 'Entregada',
  descartada: 'Descartada',
}

const ETIQUETAS_ITEM = {
  pendiente: 'Pendiente',
  preparando: 'Preparando',
  listo: 'Listo',
  entregado: 'Entregado',
  anulado: 'Anulado',
}

const puedePasar = (desde, hasta) => (TRANSICIONES_ITEM[desde] || []).includes(hasta)

/**
 * Deriva el estado de la orden a partir de sus items.
 * Mismo algoritmo que `derivarEstadoOrden` en pb_hooks/utils.js.
 * Acá se usa sólo para pintar antes de que llegue el realtime.
 */
const derivarEstadoOrden = (items) => {
  const activos = items.map((i) => i.estado).filter((s) => s !== 'anulado')
  if (activos.length === 0) return 'entregada'
  if (activos.every((s) => s === 'pendiente')) return 'cobrada'
  if (activos.every((s) => s === 'entregado')) return 'entregada'
  if (activos.every((s) => s === 'listo' || s === 'entregado')) return 'lista'
  return 'en_preparacion'
}

/** Plata en pesos, sin decimales: nadie cobra centavos en un boliche. */
const plata = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR')

/** "hace 3 min" — para saber qué está esperando hace rato. */
const desdeHace = (fecha) => {
  if (!fecha) return ''
  const ms = Date.now() - new Date(String(fecha).replace(' ', 'T')).getTime()
  if (isNaN(ms) || ms < 0) return ''
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'recién'
  if (min === 1) return 'hace 1 min'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  return `hace ${h} h ${min % 60} min`
}

/** Minutos enteros desde una fecha. Para el aviso de timeout del claim. */
const minutosDesde = (fecha) => {
  if (!fecha) return 0
  const ms = Date.now() - new Date(String(fecha).replace(' ', 'T')).getTime()
  return isNaN(ms) ? 0 : Math.floor(ms / 60000)
}

/** El claim se vence a los 8 min (TIMEOUT_MIN en pb_hooks/utils.js). */
const TIMEOUT_CLAIM_MIN = 8
