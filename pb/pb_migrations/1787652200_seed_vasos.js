/// <reference path="../pb_data/types.d.ts" />

/**
 * [PODA] punto 5 — el seed muestra cómo se usan `grupo` y `etiqueta`.
 *
 * El seed original tenía "Quilmes 1L" suelto. Se reemplaza por el par de
 * medio litro y litro, que es como se vende de verdad, para que quede un
 * ejemplo vivo de cómo se arma un botón partido.
 *
 * Los productos REALES los carga Alejo después desde `gestion.html`. Esto es
 * sólo un ejemplo de referencia: dos filas separadas en la base (dos precios,
 * dos `activo`), un botón partido en la pantalla.
 */
migrate((app) => {
  const productos = app.findCollectionByNameOrId('productos')

  // El "Quilmes 1L" del seed viejo pasa a ser la mitad grande del par.
  let quilmesLitro = null
  try {
    quilmesLitro = app.findFirstRecordByData('productos', 'nombre', 'Quilmes 1L')
  } catch (err) {
    // seed cambiado a mano: no pasa nada, se crea abajo
  }

  if (quilmesLitro) {
    quilmesLitro.set('nombre', 'Quilmes')
    quilmesLitro.set('grupo', 'quilmes')
    quilmesLitro.set('etiqueta', '1 L')
    app.save(quilmesLitro)
  } else {
    const rec = new Record(productos)
    rec.set('nombre', 'Quilmes')
    rec.set('categoria', 'cerveza')
    rec.set('precio', 7000)
    rec.set('activo', true)
    rec.set('orden', 60)
    rec.set('grupo', 'quilmes')
    rec.set('etiqueta', '1 L')
    app.save(rec)
  }

  // La otra mitad: mismo grupo, otra etiqueta, otro precio.
  const media = new Record(productos)
  media.set('nombre', 'Quilmes')
  media.set('categoria', 'cerveza')
  media.set('precio', 4500)
  media.set('activo', true)
  media.set('orden', 59)
  media.set('grupo', 'quilmes')
  media.set('etiqueta', '1/2 L')
  app.save(media)
}, (app) => {
  // down — deshacer el par, volver al "Quilmes 1L" suelto
  for (const rec of app.findAllRecords('productos')) {
    if (rec.get('grupo') === 'quilmes' && rec.get('etiqueta') === '1/2 L') {
      app.delete(rec)
    }
  }

  try {
    const litro = app.findFirstRecordByData('productos', 'etiqueta', '1 L')
    litro.set('nombre', 'Quilmes 1L')
    litro.set('grupo', '')
    litro.set('etiqueta', '')
    app.save(litro)
  } catch (err) {
    // ya no está
  }
})
