/// <reference path="../pb_data/types.d.ts" />

/**
 * Lock eventos: createRule = null
 * 
 * Antes: cualquiera con token podia escribir eventos falsos (agujero #7).
 * Despues: solo los hooks internos pueden (via $app.save).
 */
migrate((app) => {
  const eventos = app.findCollectionByNameOrId('eventos')
  eventos.createRule = null
  app.save(eventos)
}, (app) => {
  const eventos = app.findCollectionByNameOrId('eventos')
  eventos.createRule = '@request.auth.id != ""'
  app.save(eventos)
})
