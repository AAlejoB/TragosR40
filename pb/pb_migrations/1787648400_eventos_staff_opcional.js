/// <reference path="../pb_data/types.d.ts" />

/**
 * eventos.staff_id pasa a opcional.
 *
 * Por que: el evento `timeout` lo genera el cron, no una persona. Con staff_id
 * obligatorio, el cron devolvia el trago a `pendiente` pero fallaba al escribir
 * el evento, y el registro contable quedaba con un agujero justo en el caso
 * que mas interesa auditar (tragos abandonados).
 *
 * Los eventos con autor (cobrada, claim, anulado) lo siguen guardando: el hook
 * siempre lo manda. Opcional no significa vacio.
 */
migrate((app) => {
  const eventos = app.findCollectionByNameOrId('eventos')
  eventos.fields.getByName('staff_id').required = false
  app.save(eventos)
}, (app) => {
  const eventos = app.findCollectionByNameOrId('eventos')
  eventos.fields.getByName('staff_id').required = true
  app.save(eventos)
})
