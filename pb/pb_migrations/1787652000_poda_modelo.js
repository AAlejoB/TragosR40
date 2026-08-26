/// <reference path="../pb_data/types.d.ts" />

/**
 * [PODA] — simplificacion del modelo. Brief del Chat, 25 ago 2026.
 *
 * Tres cambios que sacan datos duplicados o que se desincronizan:
 *
 * 1. orden_items.cantidad SE VA. Una fila por trago: 3 Fernet = 3 registros.
 *    Con cantidad > 1 un item no puede tener UN estado (dos listos y uno
 *    todavia en preparacion), y eso contradice NO ROMPER #4 de CLAUDE.md.
 *    Agrupar "3x Fernet" pasa a ser cosa de la pantalla.
 *
 * 2. ordenes.estado de 6 valores a 3: borrador, cobrada, entregada.
 *    `en_preparacion` y `lista` eran derivables de los items, o sea datos
 *    duplicados esperando desincronizarse. `descartada` no hace falta: un
 *    borrador se borra.
 *    EL PORTON NO SE TOCA: `estado != "borrador"` sigue funcionando igual.
 *
 * 3. ordenes.metodo_pago pasa a obligatorio. Sin metodo no hay arqueo de
 *    efectivo, que es justo lo que hoy en el local no existe.
 *
 * Y un arreglo que el brief daba por hecho pero no era cierto:
 * ordenes.deleteRule estaba en null (NADIE podia borrar una orden). El brief
 * dice "un borrador se borra, el deleteRule ya lo permite". No lo permitia.
 * Se abre SOLO para borradores, y solo cajero o jefe: una orden cobrada sigue
 * sin poder borrarse jamas, porque es plata cobrada.
 */
migrate((app) => {
  // ── 1. orden_items: chau cantidad
  const items = app.findCollectionByNameOrId('orden_items')
  items.fields.removeById(items.fields.getByName('cantidad').id)
  app.save(items)

  // ── 2 y 3. ordenes
  const ordenes = app.findCollectionByNameOrId('ordenes')

  ordenes.fields.getByName('estado').values = ['borrador', 'cobrada', 'entregada']
  ordenes.fields.getByName('metodo_pago').required = true

  // Borrar un borrador si. Borrar plata cobrada no.
  ordenes.deleteRule = '(@request.auth.rol = "cajero" || @request.auth.rol = "jefe") && estado = "borrador"'

  app.save(ordenes)
}, (app) => {
  // ── down
  const items = app.findCollectionByNameOrId('orden_items')
  items.fields.add(new Field({
    type: 'number',
    name: 'cantidad',
    required: true,
    min: 1,
    onlyInt: true,
  }))
  app.save(items)

  const ordenes = app.findCollectionByNameOrId('ordenes')
  ordenes.fields.getByName('estado').values = [
    'borrador', 'cobrada', 'en_preparacion', 'lista', 'entregada', 'descartada',
  ]
  ordenes.fields.getByName('metodo_pago').required = false
  ordenes.deleteRule = null
  app.save(ordenes)
})
