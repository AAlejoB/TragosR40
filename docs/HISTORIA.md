# HISTORIA — Sistema de Tragos

> Decisiones tomadas, bugs significativos y evolución del proyecto.
> Esto es el "por qué" detrás del código. Si volvés en 6 meses, leé esto antes
> de tocar nada.
>
> **Lo llena Claude Code al cerrar cada bloque de trabajo.**

---

## 📅 Línea de tiempo

| Período | Hito |
|---|---|
| Ago 2026 | Diseño del modelo de datos y la máquina de estados (Claude Chat). Repo vacío. |
| 24 ago 2026 | **Bloque 1** — esqueleto del repo, PocketBase v0.40.1, schema de las 6 colecciones, reglas por rol, seed y suite de verificación. Sin UI. |

---

## 🏛️ Decisiones de arquitectura

### 1. Todo offline, sin cloud en el path operativo

**Estado:** decidido, no negociable.

**Por qué:** el local tiene señal celular débil y con gente adentro la celda se
satura. Un sistema que depende de la nube se cae justo en el pico de venta.

**Implicancia:** PocketBase local en vez de Supabase. Red WiFi dedicada sin
salida a internet. Sync a la nube (si se hace) es al cierre, nunca durante.

### 2. El barman no toca plata

**Estado:** decidido, es la razón de existir del sistema.

**Por qué:** el barman que cobra es la fuga de caja número uno en gastronomía
nocturna. Separar cobro de despacho es control interno, no comodidad.

**Implicancia:** la transición `borrador → cobrada` es el único portón hacia la
barra. Ver `MODELO-DATOS.md` § "Reglas duras".

### 3. Estado en el item, no en la orden

**Estado:** decidido.

**Por qué:** un pedido de 4 tragos puede tener 2 listos y 2 en preparación, con
dos barmans trabajando en paralelo sobre la misma orden.

**Implicancia:** el estado de la orden se deriva de sus items. No se escribe a
mano.

### 4. MVP sin auto-pedido del cliente

**Estado:** decidido para la primera noche.

**Por qué:** el cuello de botella real es la caja, no la barra. Y hay que medir
cuánto tarda un barman por trago antes de sumarle variables. El auto-pedido va
en fase 2.

---

### 5. `staff` es una auth collection de PocketBase; el PIN es el `password`

**Estado:** decidido en el Bloque 1. **Revisar con Alejo si no convence.**

**Por qué:** `MODELO-DATOS.md` pedía `pin` como text hasheado. Si el PIN es un
campo cualquiera, PocketBase no emite token de sesión y las reglas de acceso no
pueden mirar `@request.auth.rol` — o sea, no hay forma de separar cajero de
barman a nivel API. Guardando el PIN en el campo `password` nativo:

- lo hashea PocketBase (bcrypt), que era el requisito
- salen tokens de sesión y reglas por rol gratis
- el mínimo del campo bajó de 8 a 4 caracteres, para que entre un PIN

**Implicancia:** la identidad de login NO es el email (`identityFields:
["usuario"]`). El barman entra con `barra1` + PIN. El campo `email` quedó
opcional y vacío. El campo se llama `password` en la API, no `pin`.

### 6. La colección `users` por defecto de PocketBase se borra

**Estado:** decidido, es seguridad.

**Por qué:** PocketBase crea una colección `users` con `createRule = ""`, o sea
registro público abierto. Cualquiera conectado a la WiFi del local podía
auto-registrarse y quedar autenticado — y todas nuestras reglas de lectura
arrancan con `@request.auth.id != ""`. Habría leído el menú, los turnos y los
eventos. La migración inicial la borra.

### 7. El ejecutable de PocketBase no va al repo

**Estado:** decidido.

**Por qué:** 33 MB por binario y uno distinto por SO (la notebook de desarrollo
es Windows, el server del local va a ser Linux/ARM). Va en `.gitignore`, con las
instrucciones de descarga en `pb/README.md`. Lo que SÍ se versiona es
`pb/pb_migrations/`: el schema completo se reconstruye con `migrate up`.

---

## 🐛 Bugs significativos

*(vacío — se llena cuando aparezcan)*

### Gotchas de PocketBase que ya nos mordieron

- **Una regla de `list` no da 403, filtra.** Si no matchea, PocketBase devuelve
  `200` con la lista vacía, no un error. Al testear permisos de lectura hay que
  chequear `totalItems === 0`, no el status code.
- **Una regla de `update`/`delete` que no matchea da `404`, no `403`** — para no
  filtrar si el registro existe.

---

## 📦 Bloques de trabajo

### Bloque 1 — Esqueleto + schema (24 ago 2026)

**Qué se hizo:**

- Estructura de carpetas de `CLAUDE.md`. `MODELO-DATOS.md` e `HISTORIA.md` se
  movieron a `docs/` (`CLAUDE.md` ya los linkeaba ahí).
- PocketBase **v0.40.1** en `pb/`, corriendo en `0.0.0.0:8090`.
- `pb/pb_migrations/1787616000_init_schema.js` — las 6 colecciones con tipos,
  relaciones, índices y reglas de acceso por rol.
- `pb/pb_migrations/1787616100_seed_datos.js` — 3 staff (cajero/barman/jefe) y
  12 productos cubriendo las 4 categorías.
- `pb/verificar.mjs` — 52 chequeos end-to-end contra la API real. Sin
  dependencias (fetch nativo). **52 OK, 0 fallas.**
- `.gitignore`, `pb/README.md`, `git init` + remote a
  `https://github.com/AAlejoB/TragosR40.git`.

**Las reglas duras quedaron en el schema, no en el frontend:**

| Regla | Cómo quedó enforced |
|---|---|
| EL PORTÓN (`borrador` invisible) | `listRule`/`viewRule` de `ordenes` y `orden_items` filtran por rol: el barman no ve nada que esté en `borrador` |
| `eventos` append-only | `updateRule` y `deleteRule` en `null` — ni el jefe puede |
| El barman no toca plata | `productos` create/update solo `jefe`; `ordenes`/`orden_items` create solo `cajero`/`jefe` |
| `numero` único por turno | índice único parcial `(turno_id, numero) WHERE numero > 0` |
| Items de orden cobrada no se borran | `deleteRule` de `orden_items` exige `orden_id.estado = "borrador"` |

**Qué quedó pendiente (a propósito, no es UI todavía):**

- El **timeout del claim** `[CLAIM-TIMEOUT]` no está implementado. Necesita un
  hook Go/JS o un cron en `pb_hooks/`. Hoy un item se queda en `preparando` para
  siempre si el barman se distrae.
- La **derivación del estado de la orden** desde sus items la tiene que hacer
  quien escribe (por ahora el cliente JS). Convendría moverla a un hook
  `OnRecordAfterUpdate` de `orden_items` para que no dependa del frontend.
- **`precio_unit` y `nombre_snapshot` los copia el cliente al cobrar.** El
  schema no lo puede forzar solo. Es el candidato número uno para un hook.
- No hay validación de **transiciones de estado** (hoy la API deja saltar de
  `pendiente` a `entregado`). También hook.
- No hay chequeo de **turno abierto** al crear una orden.

**Riesgo a mirar:** las 5 cosas de arriba son la misma cosa — reglas de negocio
que hoy viven en el cliente. Si alguien abre la Admin UI o pega un `curl`, las
saltea. El próximo bloque debería ser `pb_hooks/` antes que la UI.

---

## 🔑 Keywords

*(convención: cada feature se referencia con una keyword entre corchetes, para
poder retomarla en otra conversación. Ej: `[CLAIM-TIMEOUT]`, `[ARQUEO]`)*

- `[SCHEMA]` — las 6 colecciones y sus reglas. Bloque 1. ✅
- `[CLAIM-TIMEOUT]` — devolver a `pendiente` un item abandonado. Pendiente.
- `[HOOKS]` — mover reglas de negocio del cliente al server (`pb_hooks/`). Pendiente.
- `[ARQUEO]` — reportes de cierre de turno. Pendiente.

---

## ✅ Cómo verificar que el schema está bien

```bash
cd pb && ./pocketbase serve --http=0.0.0.0:8090
```

En otra terminal, desde la raíz del repo:

```bash
node pb/verificar.mjs
```

Tiene que cerrar en **52 OK · 0 fallas**. Si algo se rompe, el script dice qué
regla falló y con qué status.

Para mirar el schema a ojo: <http://127.0.0.1:8090/_/> con el superuser.

---

## 🚀 Cómo arrancar la próxima sesión

1. Leer `CLAUDE.md` (convenciones, estructura, NO ROMPER, stack)
2. Leer `docs/MODELO-DATOS.md` (tablas, estados, reglas duras)
3. Leer este archivo completo
4. Si hay tarea específica: preguntar qué quiere atacar
5. Si no hay tarea: ofrecer la lista de pendientes de abajo

### Pendientes

1. `[HOOKS]` — mover al server las reglas que hoy tendría que respetar el
   cliente: copia de `precio_unit`/`nombre_snapshot` al cobrar, asignación de
   `numero`, derivación del estado de la orden, validación de transiciones,
   chequeo de turno abierto. **Debería ir antes que la UI.**
2. `[CLAIM-TIMEOUT]` — cron que devuelve a `pendiente` los items en
   `preparando` con más de 8 minutos, y escribe evento `timeout`.
3. UI de caja (`caja.html`) y de barra (`barra.html`).
4. Service Worker + manifest (PWA).
5. Plan B: impresora térmica y carga manual.

### Reglas de oro al arrancar

- Antes de cambios grandes o riesgosos: explicar el riesgo a Alejo y dar opciones
- Bumpear el SW al tocar cualquier archivo de `web/`
- Todo cambio de schema va como migración en `pb/pb_migrations/`
- Castellano rioplatense, vos
- **Al cerrar el bloque: actualizar este archivo + `CLAUDE.md` y avisarle a
  Alejo que los re-suba al Proyecto en Claude Chat**
