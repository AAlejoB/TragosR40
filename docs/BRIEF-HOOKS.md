# BRIEF — Bloque `[HOOKS]`

> Escrito en Claude Chat el 25 ago 2026, después del diagnóstico de
> `docs/DECISION-HOOKS.md`. **Esto es la decisión de arquitectura: ejecutar, no
> rediseñar.** Si algo de acá choca con el código real, frenar y volver al Chat.
>
> Guardar como `docs/BRIEF-HOOKS.md`.

---

## 1 · La decisión

**Opción C, corrida:** híbrido, con el `claim` del lado de las operaciones.

| Mecanismo | Qué va ahí | Por qué |
|---|---|---|
| **Operación del servidor** | `cobrar`, `anular`, `claim` | Necesitan atomicidad o tienen carrera |
| **Guarda** (`onRecordUpdateRequest`) | `listo`, `entregado`, transiciones, precio congelado, turno único | Un solo campo, sin carrera |
| **Hook after-success** | Escritura de `eventos`, derivación del estado de la orden | Consecuencia automática, nunca del cliente |
| **Cron** | `[CLAIM-TIMEOUT]` | No puede depender de una tablet prendida |

**Dos corrimientos respecto de la recomendación de Code, ambos deliberados:**

1. **`claim` es operación, no guarda.** El agujero 6 (dos barmans, mismo trago)
   es una condición de carrera, no una validación. Una guarda lee `barman_id`
   vacío y *después* escribe; en el medio entra el otro barman. Los dos pasan.
   Solo lo cierra leer y escribir en la misma transacción.
2. **La pantalla no escribe nunca en `eventos`.** Los escribe el server, en
   toda operación y toda guarda que pasa. Eso vuelve el agujero 7 imposible en
   vez de improbable, y hace que `eventos` sea reconstruible de verdad.

---

## 2 · Lo único que toca schema

Una migración nueva, mínima:

```
eventos.createRule:  '@request.auth.id != ""'   →   null
```

Sin esto, cualquiera con `curl` en la WiFi inyecta eventos falsos y el registro
contable deja de valer. Los hooks escriben por el DAO interno (`$app.save()`),
que no pasa por las reglas de colección, así que no se rompe nada.

**Nada más del schema se toca.** Ninguna otra cosa de este brief pide migración.

---

## 3 · Los tres endpoints

Todos requieren token válido. Todos validan rol. Todos escriben su evento.
Todos corren adentro de `$app.runInTransaction()`: o pasa entero, o no pasa nada.

### `POST /api/tragos/cobrar`

```
body:  { orden_id, metodo_pago }
rol:   cajero | jefe
```

Adentro de una sola transacción:

1. Si la orden **ya está `cobrada`** → devolver 200 con el `numero` que ya tiene
   y salir. **(Idempotencia: esto es lo que vuelve seguro el reintento.)**
2. La orden tiene que estar en `borrador`. Si no → 400 con motivo.
3. El turno tiene que existir y tener `cerrado_at` vacío. Si no → 400
   `"El turno está cerrado"`.
4. La orden tiene que tener al menos un item.
5. Por cada item: copiar `productos.precio → precio_unit` y
   `productos.nombre → nombre_snapshot`. **Leídos del producto adentro del hook,
   nunca del body.**
6. Calcular `total` sumando `precio_unit * cantidad`. **El total del body se
   ignora siempre.** No se compara, no se valida: se ignora.
7. Asignar `numero`: `max(numero) + 1` de las órdenes de ese turno, arrancando
   en 1. Adentro de la transacción, así no hay carrera entre dos cajas.
8. Sellar `cobrada_at`, `metodo_pago`, `estado = 'cobrada'`.
9. Escribir evento `cobrada` con `payload: { total, metodo_pago, items: N }`.

Devuelve `{ numero, total }` — es lo que la caja imprime y grita.

### `POST /api/tragos/claim`

```
body:  { item_id }
rol:   barman | jefe
```

1. Releer el item **adentro** de la transacción.
2. Si `estado != 'pendiente'` o `barman_id` no está vacío → 409 con el nombre
   de quién lo tiene. La pantalla muestra "lo está haciendo Barra 2", no un error.
3. Setear `estado = 'preparando'`, `barman_id = e.auth.id`, `claim_at = ahora`.
4. Evento `claim`.

### `POST /api/tragos/anular`

```
body:  { item_id, motivo, pin_jefe? }
rol:   barman | jefe
```

1. `motivo` es obligatorio y tiene que ser uno de:
   `se_cayo` · `cliente_se_fue` · `error_carga` · `sin_stock` · `otro`
   Cualquier otra cosa → 400. **No es texto libre.**
2. Si el item está en `pendiente`, `preparando` o `listo` → alcanza el barman.
3. Si el item está en **`entregado`** → exige `pin_jefe` y lo valida contra un
   staff con `rol = 'jefe'`. Sin eso → 403.
   *(Anular algo entregado es reescribir plata cobrada. Es la única puerta con
   llave del sistema.)*
4. `estado = 'anulado'`.
5. Evento `anulado` con `payload: { motivo, estado_previo, autorizado_por }`.
6. Re-derivar el estado de la orden (§5).

---

## 4 · Las guardas

En `onRecordUpdateRequest` de `orden_items` y `ordenes`. Rechazan con 400 y
motivo en castellano.

**`orden_items`:**

| Guarda | Regla |
|---|---|
| Transiciones válidas | Solo `pendiente→preparando→listo→entregado`. Cualquier salto → rechazo. `→anulado` solo por el endpoint, no por PATCH |
| Precio congelado | Si la orden **no** está en `borrador`, `precio_unit` y `nombre_snapshot` son inmutables |
| Claim ajeno | `barman_id` no se pisa si ya tiene valor y viene de otro usuario |
| `listo` | Exige `estado` previo `preparando` **y** que `barman_id` sea el que hace el request |
| `entregado` | Exige `estado` previo `listo` |

**`ordenes`:**

| Guarda | Regla |
|---|---|
| Estado derivado | `estado` no se escribe a mano desde la API salvo `borrador→descartada`. Lo deriva el hook (§5) |
| Cobro por PATCH | `estado = 'cobrada'` por PATCH → rechazo con `"Usá /api/tragos/cobrar"` |
| Total y número | Inmutables una vez `cobrada` |

**`turnos`:**

| Guarda | Regla |
|---|---|
| Turno único | Abrir un turno con otro sin `cerrado_at` → rechazo |
| Cerrar bloquea cobrar, **no** entregar | Un turno cerrado rechaza `cobrar`. Los items de órdenes ya cobradas se siguen despachando normal |

---

## 5 · Derivación del estado de la orden

Hook `onRecordAfterUpdateSuccess` de `orden_items`. Al escribir, no al leer.

```
todos pendiente                          → cobrada
alguno preparando, ninguno terminado     → en_preparacion
todos listo|entregado, mín. uno listo    → lista
todos entregado|anulado                  → entregada  (+ sellar entregada_at)
```

Los `anulado` se ignoran al derivar. Si **todos** los items quedan `anulado`, la
orden va a `entregada` igual (no hay nada que despachar) pero el arqueo la
cuenta como total anulado.

**Por qué al escribir:** el estado es un campo real, así el realtime de
PocketBase lo emite y la caja se actualiza sola. Si se calcula al vuelo, cada
pantalla repite la lógica y en dos meses la caja y la barra dicen cosas
distintas sobre la misma orden.

**Cuidado con el bucle:** el hook escribe en `ordenes`, no en `orden_items`. No
hay ciclo. Verificarlo igual antes de dar el bloque por cerrado.

---

## 6 · `[CLAIM-TIMEOUT]` — cron

```js
cronAdd('timeout_claim', '* * * * *', () => { ... })
```

Cada minuto: items con `estado = 'preparando'` y `claim_at` más viejo que
`TIMEOUT_MIN` → `estado = 'pendiente'`, `barman_id` vacío, `claim_at` vacío,
evento `timeout` con `payload: { barman_previo, minutos }`.

- `TIMEOUT_MIN = 8`, en un `pb_hooks/config.js` para poder cambiarlo sin tocar
  la lógica.
- **Nunca** toca items en `listo`, `entregado` o `anulado`.
- Re-deriva el estado de la orden después.

⚠️ **Riesgo de hardware:** una Raspberry Pi no tiene reloj de hardware. Sin
internet no hay NTP y arranca con la hora donde la dejó, o en 1970. Eso rompe
este cron, `cobrada_at` y todo el recuento por hora. Se resuelve con un módulo
RTC o usando la notebook vieja (tiene pila). **Decidir antes de comprar la Pi.**

---

## 7 · Orden de implementación

No cambiar el orden: cada paso apoya al siguiente.

1. **`pb_hooks/config.js` + `pb_hooks/_lib.js`** — constantes y helpers:
   `escribirEvento()`, `derivarEstadoOrden()`, `exigirRol()`, `error400()`.
   Todo lo demás los usa.
2. **La migración de `eventos.createRule`** (§2) + cortar cualquier escritura de
   eventos desde afuera.
3. **`cobrar`** — el que más duele. Con idempotencia desde el primer día.
4. **Guardas de `orden_items`** (transiciones + precio congelado).
5. **`claim`** + guarda de claim ajeno.
6. **`anular`**, con la puerta del PIN del jefe para `entregado`.
7. **Derivación** del estado de la orden.
8. **Cron del timeout.**
9. **`verificar.mjs`** — las 9 pruebas dadas vuelta + las 4 nuevas (§8).

Commitear por paso, no todo junto. Si el paso 3 anda y el 5 rompe, hay que poder
volver sin perder el 3.

---

## 8 · Criterio de "el bloque está listo"

`verificar.cmd` tiene que cerrar en **0 fallas** con:

- Los **52 chequeos actuales** intactos. Si alguno se puso rojo, un hook rompió
  un permiso: eso es una falla del bloque, no un chequeo desactualizado.
- Las **9 pruebas del diagnóstico dadas vuelta**: hoy pasan con 200, tienen que
  pasar a fallar con 400/403/409 **y con motivo legible**, no un 500.
- **4 pruebas nuevas** que no están en el diagnóstico:

| # | Prueba | Verde es |
|---|---|---|
| 53 | Cobrar la misma orden **dos veces seguidas** | Los dos devuelven **el mismo `numero`**. No se crea una segunda venta |
| 54 | Dos barmans hacen `claim` del mismo item **sin esperar respuesta del primero** | Uno gana. El otro recibe 409 con el nombre del que ganó. `barman_id` queda en el ganador |
| 55 | Item en `preparando` con `claim_at` de hace 20 min, correr el cron a mano | Vuelve a `pendiente`, `barman_id` vacío, evento `timeout` escrito |
| 56 | Anular un item **`entregado`** sin `pin_jefe` | 403. Con el PIN correcto, 200 + evento con `autorizado_por` |

La 53 y la 54 son las importantes: son las dos carreras, y son la razón por la
que este bloque va en Opus y no en Sonnet.

---

## 9 · Al cerrar el bloque

Además del loop de sincronización de `CLAUDE.md`:

- Dejar escrito **en `CLAUDE.md`** cuál es la regla de ruteo, o en seis meses no
  se entiende por qué conviven dos estilos:

  > **Operación del servidor** si toca plata, o si dos personas pueden hacerla
  > sobre lo mismo al mismo tiempo. **Guarda** si es un campo y un actor.

- Sumar a `HISTORIA.md` § Keywords:
  - `[STOCK]` — apagar solo un producto cuando se agota. Hoy es manual con el
    toggle `activo`. Fase 2.
- Anotar en `HISTORIA.md` la decisión de **turno = ciclo de caja, no horario de
  puertas**, y que **cerrar el turno bloquea cobrar pero no entregar**.

---

## 10 · Nota de implementación

Los nombres exactos de la API de hooks (`routerAdd`, `onRecordUpdateRequest`,
`onRecordAfterUpdateSuccess`, `cronAdd`, `$app.runInTransaction`,
`e.requestInfo()`, `e.auth`) **verificarlos contra `pb/pb_data/types.d.ts`**,
que es el archivo de tipos que genera PocketBase v0.40.1. No asumir la firma de
memoria: entre versiones cambiaron.

**Para Alejo:** después de este bloque, `arrancar.cmd` y `verificar.cmd` siguen
funcionando igual. Lo único que va a cambiar en pantalla es que `verificar`
termine diciendo **65 OK · 0 fallas** en vez de 52.
