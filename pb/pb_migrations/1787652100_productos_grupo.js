/// <reference path="../pb_data/types.d.ts" />

/**
 * [PODA] punto 4 — `grupo` y `etiqueta` en productos.
 *
 * Para qué: en el local se vende el mismo trago en vaso de 1/2 L y de 1 L.
 * Son dos precios distintos, o sea DOS PRODUCTOS distintos en la base. Pero
 * en la pantalla de caja conviene verlos como un solo botón partido en dos,
 * para no llenar la grilla de duplicados.
 *
 *   grupo    — los productos que comparten grupo se dibujan juntos
 *              (ej: "quilmes")
 *   etiqueta — lo que dice cada mitad del botón (ej: "1/2 L", "1 L")
 *
 * IMPORTANTE: el agrupado es SOLO VISUAL. Siguen siendo productos separados,
 * con su propio precio, su propio `activo` y su propia fila en cada venta.
 * El servidor no sabe nada de grupos: cobra productos, no botones.
 *
 * Ambos opcionales: un producto sin `grupo` se dibuja como botón entero, que
 * es el caso de la enorme mayoría del menú.
 *
 * Este bloque NO dibuja nada: sólo deja el schema listo. La pantalla partida
 * va en el bloque siguiente, con su propio brief.
 */
migrate((app) => {
  const productos = app.findCollectionByNameOrId('productos')

  productos.fields.add(new Field({
    type: 'text',
    name: 'grupo',
    max: 40,
  }))

  productos.fields.add(new Field({
    type: 'text',
    name: 'etiqueta',
    max: 20,
  }))

  app.save(productos)
}, (app) => {
  const productos = app.findCollectionByNameOrId('productos')
  productos.fields.removeById(productos.fields.getByName('grupo').id)
  productos.fields.removeById(productos.fields.getByName('etiqueta').id)
  app.save(productos)
})
