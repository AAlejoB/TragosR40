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
| `grupo` | text | Opcional. Los que comparten grupo se dibujan como un botón partido |
| `etiqueta` | text | Opcional. Lo que dice cada mitad: `1/2 L`, `1 L` |

**`grupo` y `etiqueta` son SOLO visuales.** El vaso de ½ L y el de 1 L son
dos productos distintos en la base, con su propio precio y su propio `activo`.
Se agrupan nada más que para no llenar la grilla de la caja de duplicados. El
servidor no sabe nada de grupos: cobra productos, no botones.

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

#### La `fecha` del turno NO es la fecha del reloj

**Se calcula como `abierto_at` menos 6 horas.**

El boliche abre a la 01:00 del sábado y cierra a las 06:00 del domingo. Sin
esta corrección, la venta del sábado a la noche figuraría como venta del
domingo, y el arqueo del sábado saldría vacío.

Restando 6 horas, todo lo que pasa entre la 01:00 y las 06:59 del domingo cae
en el sábado, que es la noche que realmente fue.

**Lo calcula el servidor, nunca la pantalla.** Está en dos lugares para que
valga por cualquier vía de entrada: el endpoint `POST /api/tragos/turno` y una
guarda en el create de `turnos` que pisa la `fecha` que venga de afuera.

**Ojo con la zona horaria:** el server guarda en UTC y Comodoro está en UTC−3.
Si el corte se hiciera sobre UTC, a las 05:00 de la madrugada daría el día
equivocado — que es justo el caso que esto viene a arreglar. Se restan las 9
horas de una vez (3 de zona + 6 de corte). Argentina no cambia la hora desde
2009, así que el offset fijo es seguro. ✅ Implementado y verificado con los 5
horarios reales del boliche.

#### Turno único y auto-apertura

- **Turno único:** no puede haber dos turnos abiertos a la vez (era el agujero
  #9 del diagnóstico). Ya está implementado y verificado.
- **Auto-apertura:** ✅ si no hay ningún turno abierto, el primer cobro lo crea.
  Nadie tiene que acordarse de apretar "abrir turno" a la 01:00 con gente
  esperando. Lo hace `POST /api/tragos/turno`, que es *conseguir-o-crear*:
  llamarlo diez veces devuelve el mismo turno.

**Por qué es un endpoint y no parte de `cobrar`:** una orden necesita
`turno_id` para existir, así que el turno tiene que estar **antes** de crear la
orden. La caja llama a este endpoint y sigue. La búsqueda y la creación van en
la misma transacción, así dos cajas que arrancan al mismo tiempo no abren dos
turnos.

### `ordenes`
La cabecera del pedido.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK interno |
| `turno_id` | rel → turnos | |
| `numero` | number | 1-999, resetea por turno. Es lo que se grita |
| `estado` | select | `borrador` · `cobrada` · `entregada` |
| `total` | number | Suma congelada al cobrar |
| `metodo_pago` | select | **Obligatorio.** `efectivo` · `tarjeta` · `transferencia` |
| `cajero_id` | rel → staff | |
| `created_at` | datetime | |
| `cobrada_at` | datetime | |
| `entregada_at` | datetime | |

### `orden_items`
**Una fila por trago.** 3 Fernet son 3 registros, no uno con `cantidad: 3`.
Acá vive el estado real.

Por qué no hay `cantidad`: con 3 en una sola fila, esa fila no puede tener UN
estado — el barman termina uno y los otros dos siguen en preparación. Agrupar
"3× Fernet" en pantalla es cosa de la pantalla, no del modelo.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `orden_id` | rel → ordenes | |
| `producto_id` | rel → productos | |
| `nombre_snapshot` | text | Nombre al momento de cobrar |
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
  borrador ────────▶│     cobrada     │──────────────▶ entregada
     │              └─────────────────┘         (cuando no queda
     ▼                                           nada por entregar)
  se BORRA
```

Un borrador que no se cobra **se borra** (el `deleteRule` lo permite sólo
mientras siga en borrador). Una orden cobrada no se borra nunca: es plata.

### Item

```
  pendiente ───▶ preparando ───▶ listo ───▶ entregado
      │              │             │
      └──────────────┴─────────────┴────────▶ anulado
```

### Derivación del estado de la orden

| Si los items están... | La orden está |
|---|---|
| Queda alguno sin entregar | `cobrada` |
| Todos `entregado` o `anulado` | `entregada` |

Los items `anulado` se ignoran al derivar.

**Por qué sólo dos filas:** `en_preparacion` y `lista` eran una copia del
estado de los items, guardada aparte y esperando desincronizarse. Si querés
saber si un pedido está a medio hacer, mirá los items — que es donde vive el
estado real. La orden sólo necesita saber si ya terminó o no.

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

**Timeout:** si nadie lo marca `listo` en 8 minutos, vuelve a `pendiente`, se
limpia `barman_id` y se escribe evento `timeout`. Sin esto, un barman que se
distrae congela el pedido. ✅ Implementado (cron cada minuto) y verificado.

> El brief de [PODA] pedía posponerlo, asumiendo una sola pantalla en la barra.
> **No se pospuso**, porque el supuesto no se sostiene: Alejo confirmó 3-4
> barmans trabajando sobre la misma cola, que es exactamente el escenario para
> el que existe el claim. Además ya estaba hecho, probado y pasando. Sacarlo
> habría sido perder algo que ya sirve para el caso real.

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
| Tragos por producto | `count(orden_items)` por `producto_id`, estado `entregado`, filtrado por turno. Como cada fila es un trago, contar es `count()`, nunca `sum(cantidad)` |
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
