# MODELO-DATOS — Sistema de Tragos

> El schema y las reglas de negocio. Si vas a tocar tablas o estados, leé esto primero.

---

## 🗄️ Tablas

### `staff`
Quién opera el sistema.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `nombre` | text | |
| `rol` | select | `cajero` · `barman` · `jefe` |
| `pin` | text | 4 dígitos. Hasheado. No password: esto es un boliche |
| `activo` | bool | Baja lógica |

### `productos`
El menú.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `nombre` | text | |
| `categoria` | select | `trago` · `cerveza` · `shot` · `sin_alcohol` |
| `precio` | number | Precio ACTUAL. No es el que se cobra en órdenes viejas |
| `activo` | bool | Si se acaba el Fernet, lo apagás y desaparece de la caja |
| `orden` | number | Orden de aparición en pantalla |

### `turnos`
Una noche.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `fecha` | date | |
| `abierto_at` | datetime | |
| `cerrado_at` | datetime | null mientras está abierto |
| `abierto_por` | rel → staff | |

Sin turno abierto no se pueden crear órdenes. El recuento se calcula contra el turno.

### `ordenes`
La cabecera del pedido.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK interno |
| `turno_id` | rel → turnos | |
| `numero` | number | 1-999, resetea por turno. Es lo que se grita |
| `estado` | select | `borrador` · `cobrada` · `en_preparacion` · `lista` · `entregada` · `descartada` |
| `total` | number | Suma congelada al cobrar |
| `metodo_pago` | select | `efectivo` · `tarjeta` · `transferencia` |
| `cajero_id` | rel → staff | |
| `created_at` | datetime | |
| `cobrada_at` | datetime | |
| `entregada_at` | datetime | |

### `orden_items`
Una fila por trago. **Acá vive el estado real.**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `orden_id` | rel → ordenes | |
| `producto_id` | rel → productos | |
| `nombre_snapshot` | text | Nombre al momento de cobrar |
| `cantidad` | number | |
| `precio_unit` | number | **Copiado del producto al cobrar. Nunca se recalcula** |
| `estado` | select | `pendiente` · `preparando` · `listo` · `entregado` · `anulado` |
| `barman_id` | rel → staff | Quién lo tomó. null hasta el claim |
| `claim_at` | datetime | Cuándo lo tomó. Para el timeout |

### `eventos`
Append-only. El registro contable.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `orden_id` | rel → ordenes | |
| `item_id` | rel → orden_items | null si el evento es de la orden entera |
| `tipo` | text | `creada` · `cobrada` · `claim` · `listo` · `entregado` · `anulado` · `timeout` |
| `staff_id` | rel → staff | |
| `payload` | json | Contexto extra (motivo de anulación, etc.) |
| `created_at` | datetime | |

**Nunca se edita ni se borra.** Si el server se corta, todo se reconstruye desde acá.

---

## 🔀 Máquina de estados

### Orden

```
                    ┌─── EL PORTÓN ───┐
  borrador ────────▶│     cobrada     │────▶ en_preparacion ──▶ lista ──▶ entregada
     │              └─────────────────┘              ▲            ▲          ▲
     ▼                                               └────────────┴──────────┘
  descartada                                   (derivado del estado de los items)
```

### Item

```
  pendiente ───▶ preparando ───▶ listo ───▶ entregado
      │              │             │
      └──────────────┴─────────────┴────────▶ anulado
```

### Derivación del estado de la orden

| Si los items están... | La orden está |
|---|---|
| Todos `pendiente` | `cobrada` |
| Alguno `preparando`, ninguno terminado | `en_preparacion` |
| Todos `listo` o `entregado` (mín. uno `listo`) | `lista` |
| Todos `entregado` o `anulado` | `entregada` |

Los items `anulado` se ignoran al derivar.

---

## 🔒 Reglas duras

### 1. `borrador → cobrada` es el portón
Es la ÚNICA transición que hace visibles los items para la barra. Nada llega al
barman sin que la caja haya confirmado el cobro. Un pedido en `borrador` no
existe para la barra.

En esta transición:
- Se copia `precio` → `precio_unit` en cada item
- Se copia `nombre` → `nombre_snapshot`
- Se congela `total`
- Se asigna `numero` (siguiente del turno)
- Se escribe evento `cobrada`

### 2. `pendiente → preparando` es un claim
El barman toca el trago y queda marcado con su `barman_id` + `claim_at`, para
que dos no preparen el mismo.

**Necesita timeout:** si nadie lo marca `listo` en N minutos (arrancar con 8),
vuelve a `pendiente`, se limpia `barman_id` y se escribe evento `timeout`.
Sin esto, un barman que se distrae congela el pedido.

### 3. `precio_unit` no se recalcula jamás
Si a las 3am subís el precio del Gin Tonic, las órdenes ya cobradas no pueden
mutar. Renderizar una orden vieja usa `precio_unit` y `nombre_snapshot`, nunca
la tabla `productos`.

### 4. `numero` corto, `id` UUID
Nadie grita un UUID por encima de la música. El `numero` es de 1 a 999 y
resetea con cada turno. El `id` es interno y nunca se muestra.

### 5. Anular requiere motivo y queda registrado
`anulado` guarda `staff_id` y `payload.motivo`. Es la contracara del control
interno: si el barman no toca plata, el único agujero que queda es anular
tragos ya cobrados.

---

## 📊 Recuento (sale gratis de este modelo)

| Métrica | Cómo |
|---|---|
| Tragos por producto | `count(orden_items)` por `producto_id`, estado `entregado`, filtrado por turno |
| Tragos por hora | Agrupar `eventos` tipo `entregado` por hora |
| Productividad por barman | `count` por `barman_id` |
| Tiempo promedio de preparación | `avg(listo_at - claim_at)` desde `eventos` |
| Tiempo total cliente | `avg(entregada_at - cobrada_at)` en `ordenes` |
| Anulaciones | `eventos` tipo `anulado`, agrupado por `staff_id` |
| Arqueo de caja | `sum(total)` por `metodo_pago` y `cajero_id` del turno |

---

## 🚧 Fuera del MVP (fase 2+)

- **Auto-pedido del cliente** (`cliente.html`): el cliente arma el pedido en su
  celular vía QR a la WiFi local, y le muestra un código a la caja. Va después
  de medir cuánto tarda un barman por trago.
- **Pulsera NFC con saldo precargado** en la entrada. Saca la caja del loop en
  cada trago y desaparece la cola. Es el salto grande.
- **Sincronización a la nube** al cierre del turno, para reportes históricos.

## 🩹 Plan B obligatorio (sí es MVP)

- Impresora térmica en caja con el número grande impreso
- Talonario numerado en papel: si el server se cae, se sigue vendiendo y se
  carga después
- La caja debe poder cargar un pedido a mano sin celular del cliente: batería
  muerta, pantalla rota, o simplemente no entiende el QR

Un boliche no puede dejar de vender diez minutos.
