/// <reference path="../pb_data/types.d.ts" />

/**
 * Schema inicial — Sistema de Tragos.
 * 6 colecciones: staff, productos, turnos, ordenes, orden_items, eventos.
 * Ver docs/MODELO-DATOS.md
 */
migrate((app) => {
  // PocketBase crea una colección `users` con createRule = "" (registro
  // público abierto). Cualquiera en la WiFi se auto-registraría y pasaría
  // los `@request.auth.id != ""`. No la usamos: afuera.
  try {
    app.delete(app.findCollectionByNameOrId('users'))
  } catch (err) {
    // instalación sin la colección por defecto
  }

  // ─────────────────────────────────────────────────────────────
  // staff — auth collection. El PIN es el password (bcrypt por PB).
  // Identidad = `usuario` (no email: esto es un boliche).
  // ─────────────────────────────────────────────────────────────
  const staff = new Collection({
    type: 'auth',
    name: 'staff',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.rol = "jefe"',
    updateRule: '@request.auth.rol = "jefe" || id = @request.auth.id',
    deleteRule: null,
    authRule: 'activo = true',
    manageRule: '@request.auth.rol = "jefe"',
    passwordAuth: {
      enabled: true,
      identityFields: ['usuario'],
    },
    fields: [
      {
        type: 'text',
        name: 'usuario',
        required: true,
        min: 3,
        max: 30,
        pattern: '^[a-z0-9_]+$',
      },
      {
        type: 'text',
        name: 'nombre',
        required: true,
        max: 60,
      },
      {
        type: 'select',
        name: 'rol',
        required: true,
        maxSelect: 1,
        values: ['cajero', 'barman', 'jefe'],
      },
      {
        type: 'bool',
        name: 'activo',
      },
      {
        type: 'autodate',
        name: 'created_at',
        onCreate: true,
        onUpdate: false,
      },
      {
        type: 'autodate',
        name: 'updated_at',
        onCreate: true,
        onUpdate: true,
      },
    ],
    indexes: [
      'CREATE UNIQUE INDEX `idx_staff_usuario` ON `staff` (`usuario`)',
    ],
  })
  app.save(staff)

  // el PIN son 4 dígitos, no una contraseña de 8
  staff.fields.getByName('password').min = 4
  // el barman no tiene mail corporativo. La identidad es `usuario`.
  staff.fields.getByName('email').required = false
  app.save(staff)

  // ─────────────────────────────────────────────────────────────
  // productos — el menú
  // ─────────────────────────────────────────────────────────────
  const productos = new Collection({
    type: 'base',
    name: 'productos',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.rol = "jefe"',
    updateRule: '@request.auth.rol = "jefe"',
    deleteRule: null,
    fields: [
      {
        type: 'text',
        name: 'nombre',
        required: true,
        max: 60,
      },
      {
        type: 'select',
        name: 'categoria',
        required: true,
        maxSelect: 1,
        values: ['trago', 'cerveza', 'shot', 'sin_alcohol'],
      },
      {
        type: 'number',
        name: 'precio',
        required: true,
        min: 0,
      },
      {
        type: 'bool',
        name: 'activo',
      },
      {
        type: 'number',
        name: 'orden',
        min: 0,
        onlyInt: true,
      },
      {
        type: 'autodate',
        name: 'created_at',
        onCreate: true,
        onUpdate: false,
      },
      {
        type: 'autodate',
        name: 'updated_at',
        onCreate: true,
        onUpdate: true,
      },
    ],
    indexes: [
      'CREATE INDEX `idx_productos_activo_orden` ON `productos` (`activo`, `orden`)',
    ],
  })
  app.save(productos)

  // ─────────────────────────────────────────────────────────────
  // turnos — una noche
  // ─────────────────────────────────────────────────────────────
  const turnos = new Collection({
    type: 'base',
    name: 'turnos',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.rol = "jefe" || @request.auth.rol = "cajero"',
    updateRule: '@request.auth.rol = "jefe" || @request.auth.rol = "cajero"',
    deleteRule: null,
    fields: [
      {
        type: 'date',
        name: 'fecha',
        required: true,
      },
      {
        type: 'date',
        name: 'abierto_at',
        required: true,
      },
      {
        type: 'date',
        name: 'cerrado_at',
      },
      {
        type: 'relation',
        name: 'abierto_por',
        required: true,
        collectionId: staff.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        type: 'autodate',
        name: 'created_at',
        onCreate: true,
        onUpdate: false,
      },
      {
        type: 'autodate',
        name: 'updated_at',
        onCreate: true,
        onUpdate: true,
      },
    ],
    indexes: [
      'CREATE INDEX `idx_turnos_cerrado_at` ON `turnos` (`cerrado_at`)',
      'CREATE INDEX `idx_turnos_fecha` ON `turnos` (`fecha`)',
    ],
  })
  app.save(turnos)

  // ─────────────────────────────────────────────────────────────
  // ordenes — cabecera del pedido
  // EL PORTÓN: `borrador` es invisible para el barman (regla de acceso).
  // ─────────────────────────────────────────────────────────────
  const ordenes = new Collection({
    type: 'base',
    name: 'ordenes',
    listRule: '@request.auth.rol = "cajero" || @request.auth.rol = "jefe" || (@request.auth.rol = "barman" && estado != "borrador")',
    viewRule: '@request.auth.rol = "cajero" || @request.auth.rol = "jefe" || (@request.auth.rol = "barman" && estado != "borrador")',
    createRule: '@request.auth.rol = "cajero" || @request.auth.rol = "jefe"',
    updateRule: '@request.auth.rol = "cajero" || @request.auth.rol = "jefe" || (@request.auth.rol = "barman" && estado != "borrador")',
    deleteRule: null,
    fields: [
      {
        type: 'relation',
        name: 'turno_id',
        required: true,
        collectionId: turnos.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        type: 'number',
        name: 'numero',
        min: 1,
        max: 999,
        onlyInt: true,
      },
      {
        type: 'select',
        name: 'estado',
        required: true,
        maxSelect: 1,
        values: ['borrador', 'cobrada', 'en_preparacion', 'lista', 'entregada', 'descartada'],
      },
      {
        type: 'number',
        name: 'total',
        min: 0,
      },
      {
        type: 'select',
        name: 'metodo_pago',
        maxSelect: 1,
        values: ['efectivo', 'tarjeta', 'transferencia'],
      },
      {
        type: 'relation',
        name: 'cajero_id',
        required: true,
        collectionId: staff.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        type: 'date',
        name: 'cobrada_at',
      },
      {
        type: 'date',
        name: 'entregada_at',
      },
      {
        type: 'autodate',
        name: 'created_at',
        onCreate: true,
        onUpdate: false,
      },
      {
        type: 'autodate',
        name: 'updated_at',
        onCreate: true,
        onUpdate: true,
      },
    ],
    indexes: [
      'CREATE UNIQUE INDEX `idx_ordenes_turno_numero` ON `ordenes` (`turno_id`, `numero`) WHERE `numero` > 0',
      'CREATE INDEX `idx_ordenes_turno_estado` ON `ordenes` (`turno_id`, `estado`)',
    ],
  })
  app.save(ordenes)

  // ─────────────────────────────────────────────────────────────
  // orden_items — acá vive el estado real
  // ─────────────────────────────────────────────────────────────
  const items = new Collection({
    type: 'base',
    name: 'orden_items',
    listRule: '@request.auth.rol = "cajero" || @request.auth.rol = "jefe" || (@request.auth.rol = "barman" && orden_id.estado != "borrador")',
    viewRule: '@request.auth.rol = "cajero" || @request.auth.rol = "jefe" || (@request.auth.rol = "barman" && orden_id.estado != "borrador")',
    createRule: '@request.auth.rol = "cajero" || @request.auth.rol = "jefe"',
    updateRule: '@request.auth.rol = "cajero" || @request.auth.rol = "jefe" || (@request.auth.rol = "barman" && orden_id.estado != "borrador")',
    deleteRule: '(@request.auth.rol = "cajero" || @request.auth.rol = "jefe") && orden_id.estado = "borrador"',
    fields: [
      {
        type: 'relation',
        name: 'orden_id',
        required: true,
        collectionId: ordenes.id,
        cascadeDelete: true,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        type: 'relation',
        name: 'producto_id',
        required: true,
        collectionId: productos.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        type: 'text',
        name: 'nombre_snapshot',
        max: 60,
      },
      {
        type: 'number',
        name: 'cantidad',
        required: true,
        min: 1,
        onlyInt: true,
      },
      {
        type: 'number',
        name: 'precio_unit',
        min: 0,
      },
      {
        type: 'select',
        name: 'estado',
        required: true,
        maxSelect: 1,
        values: ['pendiente', 'preparando', 'listo', 'entregado', 'anulado'],
      },
      {
        type: 'relation',
        name: 'barman_id',
        collectionId: staff.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        type: 'date',
        name: 'claim_at',
      },
      {
        type: 'autodate',
        name: 'created_at',
        onCreate: true,
        onUpdate: false,
      },
      {
        type: 'autodate',
        name: 'updated_at',
        onCreate: true,
        onUpdate: true,
      },
    ],
    indexes: [
      'CREATE INDEX `idx_items_orden` ON `orden_items` (`orden_id`)',
      'CREATE INDEX `idx_items_estado_claim` ON `orden_items` (`estado`, `claim_at`)',
      'CREATE INDEX `idx_items_barman` ON `orden_items` (`barman_id`)',
      'CREATE INDEX `idx_items_producto` ON `orden_items` (`producto_id`)',
    ],
  })
  app.save(items)

  // ─────────────────────────────────────────────────────────────
  // eventos — APPEND-ONLY. update y delete bloqueados a nivel API.
  // ─────────────────────────────────────────────────────────────
  const eventos = new Collection({
    type: 'base',
    name: 'eventos',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: null,
    deleteRule: null,
    fields: [
      {
        type: 'relation',
        name: 'orden_id',
        required: true,
        collectionId: ordenes.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        type: 'relation',
        name: 'item_id',
        collectionId: items.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        type: 'text',
        name: 'tipo',
        required: true,
        max: 30,
      },
      {
        type: 'relation',
        name: 'staff_id',
        required: true,
        collectionId: staff.id,
        cascadeDelete: false,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        type: 'json',
        name: 'payload',
        maxSize: 2000000,
      },
      {
        type: 'autodate',
        name: 'created_at',
        onCreate: true,
        onUpdate: false,
      },
    ],
    indexes: [
      'CREATE INDEX `idx_eventos_orden` ON `eventos` (`orden_id`)',
      'CREATE INDEX `idx_eventos_tipo_created` ON `eventos` (`tipo`, `created_at`)',
      'CREATE INDEX `idx_eventos_staff` ON `eventos` (`staff_id`)',
    ],
  })
  app.save(eventos)
}, (app) => {
  // down — orden inverso por las FK
  const nombres = ['eventos', 'orden_items', 'ordenes', 'turnos', 'productos', 'staff']
  for (const nombre of nombres) {
    try {
      app.delete(app.findCollectionByNameOrId(nombre))
    } catch (err) {
      // ya no existe
    }
  }
})
