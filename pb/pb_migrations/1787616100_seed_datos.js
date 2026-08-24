/// <reference path="../pb_data/types.d.ts" />

/**
 * Seed de prueba — 3 staff (uno por rol) y 12 productos.
 *
 * ⚠️ PINes de prueba. Cambiarlos antes de la primera noche real.
 */
migrate((app) => {
  const staff = app.findCollectionByNameOrId('staff')

  const gente = [
    { usuario: 'caja1', nombre: 'Caja 1', rol: 'cajero', pin: '1111' },
    { usuario: 'barra1', nombre: 'Barra 1', rol: 'barman', pin: '2222' },
    { usuario: 'jefe', nombre: 'Alejo', rol: 'jefe', pin: '9999' },
  ]

  for (const p of gente) {
    const rec = new Record(staff)
    rec.set('usuario', p.usuario)
    rec.set('nombre', p.nombre)
    rec.set('rol', p.rol)
    rec.set('activo', true)
    rec.set('verified', true)
    rec.set('password', p.pin)
    rec.set('passwordConfirm', p.pin)
    app.save(rec)
  }

  const productos = app.findCollectionByNameOrId('productos')

  const menu = [
    { nombre: 'Fernet con Coca', categoria: 'trago', precio: 8000 },
    { nombre: 'Gin Tonic', categoria: 'trago', precio: 9000 },
    { nombre: 'Vodka con Speed', categoria: 'trago', precio: 8500 },
    { nombre: 'Cuba Libre', categoria: 'trago', precio: 8500 },
    { nombre: 'Campari con Naranja', categoria: 'trago', precio: 9000 },
    { nombre: 'Quilmes 1L', categoria: 'cerveza', precio: 7000 },
    { nombre: 'Heineken porrón', categoria: 'cerveza', precio: 8000 },
    { nombre: 'Andes IPA pinta', categoria: 'cerveza', precio: 8500 },
    { nombre: 'Jäger', categoria: 'shot', precio: 6000 },
    { nombre: 'Tequila', categoria: 'shot', precio: 6000 },
    { nombre: 'Coca-Cola', categoria: 'sin_alcohol', precio: 3000 },
    { nombre: 'Agua mineral', categoria: 'sin_alcohol', precio: 2500 },
  ]

  let i = 0
  for (const p of menu) {
    i += 10
    const rec = new Record(productos)
    rec.set('nombre', p.nombre)
    rec.set('categoria', p.categoria)
    rec.set('precio', p.precio)
    rec.set('activo', true)
    rec.set('orden', i)
    app.save(rec)
  }
}, (app) => {
  for (const nombre of ['caja1', 'barra1', 'jefe']) {
    try {
      app.delete(app.findFirstRecordByData('staff', 'usuario', nombre))
    } catch (err) {
      // ya no está
    }
  }

  for (const rec of app.findAllRecords('productos')) {
    app.delete(rec)
  }
})
