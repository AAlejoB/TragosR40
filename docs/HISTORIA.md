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
| 24 ago 2026 | **Bloque 1b** — `arrancar.cmd` y `verificar.cmd` (doble clic, sin terminal), manual de operación y guía de qué modelo usar en cada bloque. |
| 25 ago 2026 | **Bloque 2** — push inicial a GitHub. Diagnóstico de `[HOOKS]`: 9 agujeros medidos contra el servidor real y 3 opciones de arquitectura. **Frenado a propósito**: la decisión va al Chat. Ver [`DECISION-HOOKS.md`](DECISION-HOOKS.md). |

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

### Gotchas de Windows que ya nos mordieron

- **Un `.cmd` guardado con saltos de línea de Unix (LF) se rompe.** cmd.exe lo
  parsea mal y aparecen errores absurdos tipo `"endo" no se reconoce como un
  comando` (se comió la `ec` de `echo`). Los `.cmd` de este repo **tienen que
  guardarse con CRLF**. Si tocás uno, revisá que siga en CRLF.
- **Dentro de un `.cmd` hay que llamar al ejecutable con la ruta completa.**
  `pocketbase.exe` a secas falló aun estando en la carpeta correcta; con
  `"%~dp0pb\pocketbase.exe"` anda siempre.
- **Los acentos en las líneas `echo` de un `.cmd` salen mal.** cmd lee el
  archivo con la codificación vieja *antes* de que `chcp 65001` haga efecto. Los
  banners de los `.cmd` van sin acentos. El `chcp` igual sirve: hace que se vea
  bien la salida de PocketBase y de `verificar.mjs`.

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

### Bloque 2 — Push y diagnóstico de `[HOOKS]` (25 ago 2026)

**Qué se hizo:**

- `git push` inicial. Los 2 commits del Bloque 1 ya están en
  <https://github.com/AAlejoB/TragosR40.git>.
- Se midió contra el servidor prendido **qué deja pasar hoy la API sin hooks**:
  **9 agujeros abiertos**, cada uno con un `200 OK` que no debería existir. La
  tabla completa está en [`DECISION-HOOKS.md`](DECISION-HOOKS.md).
- Se escribieron 3 opciones de arquitectura (operaciones del servidor / guardas
  de validación / híbrido) con lo que cierra y lo que no cierra cada una.

**Qué NO se hizo, a propósito:** ni una línea de `pb_hooks/`. Alejo eligió
frenar y llevar la decisión al Chat, que es lo que dice la división de trabajo
de `CLAUDE.md`.

**Lo que quedó claro con la medición:** el schema cubre bien *quién puede tocar
qué* (permisos), pero no cubre nada de *qué es una operación válida*. Los cuatro
agujeros que más duelen (cobrar sin congelar el precio, total inventado,
reescribir un precio ya cobrado, anular sin motivo) **no se ven en pantalla**:
se ven en el arqueo. Son justo los que conviene volver imposibles.

**Guardado para cuando haya decisión:** el script que mide los 9 agujeros está
escrito y probado. Cuando se implementen los hooks, esas 9 pruebas se dan vuelta
—hoy pasan, tienen que pasar a fallar— y se suman a `verificar.mjs`. Ese es el
criterio de "el bloque está listo".

---

## 🔑 Keywords

*(convención: cada feature se referencia con una keyword entre corchetes, para
poder retomarla en otra conversación. Ej: `[CLAIM-TIMEOUT]`, `[ARQUEO]`)*

- `[SCHEMA]` — las 6 colecciones y sus reglas. Bloque 1. ✅
- `[CLAIM-TIMEOUT]` — devolver a `pendiente` un item abandonado. Pendiente.
- `[HOOKS]` — mover reglas de negocio del cliente al server (`pb_hooks/`). Pendiente.
- `[ARQUEO]` — reportes de cierre de turno. Pendiente.

---

## 🖥️ Manual de operación — paso a paso

> Escrito para que lo siga alguien que no programa. Si algo de acá no se
> entiende, el problema es el texto, no el lector: avisá y se reescribe.

### Primero: dónde se escriben las cosas

Hay tres lugares distintos y es fácil confundirlos.

| Lugar | Qué es | Qué va ahí |
|---|---|---|
| **El cuadro de Claude Code** | Donde le escribís a Claude en castellano | Pedidos, preguntas. **Nunca comandos.** |
| **La terminal de Windows** | Una ventana negra con letras blancas | Los comandos. Todo lo que en estos docs aparece en un bloque gris con letra de máquina de escribir |
| **El Explorador de Windows** | La carpeta del proyecto | Doble clic en los archivos `.cmd`. Es el atajo que evita la terminal |

Cuando en cualquier doc de este repo veas un bloque así:

```powershell
node pb\verificar.mjs
```

...eso va **en la terminal**, no en el chat con Claude.

### Las 3 cosas que vas a hacer siempre

#### A · Arrancar el servidor

Explorador de Windows → entrá a la carpeta `TRAGOS RUTA40` → **doble clic en
`arrancar.cmd`**.

Se abre una ventana negra que termina diciendo:

```
Server started at http://0.0.0.0:8090
```

**Dejá esa ventana abierta.** Mientras esté abierta, el sistema está prendido.
Si la cerrás, se apaga todo.

<details>
<summary>Si preferís hacerlo por terminal</summary>

```powershell
cd "C:\Users\Alejo\OneDrive\Documentos\CLAUDE\TRAGOS RUTA40\pb"
.\pocketbase.exe serve --http=0.0.0.0:8090
```
</details>

#### B · Verificar que el schema está bien

Con el servidor ya arrancado (paso A), **doble clic en `verificar.cmd`**.

Tiene que terminar así:

```
────────────────────────────────────────────
  52 OK · 0 fallas
────────────────────────────────────────────
```

Si dice **0 fallas**, el schema está sano. Si dice cualquier otro número,
copiá las líneas que digan `FALLA` y pasámelas por el chat.

<details>
<summary>Si preferís hacerlo por terminal</summary>

```powershell
cd "C:\Users\Alejo\OneDrive\Documentos\CLAUDE\TRAGOS RUTA40"
node pb\verificar.mjs
```
</details>

#### C · Apagar el servidor

Cerrás la ventana negra que abrió `arrancar.cmd`. O apretás `Ctrl+C` adentro
de ella.

### Cómo abrir una terminal parada en la carpeta correcta

Esto hace falta para git y poco más. Dos formas:

1. Explorador de Windows → entrá a la carpeta `TRAGOS RUTA40` → clic en la
   **barra de direcciones** (donde dice la ruta) → borrá lo que hay, escribí
   `powershell` y Enter.
2. `Shift` + clic derecho sobre la carpeta → *"Abrir ventana de PowerShell aquí"*.

Sabés que estás bien parado porque el renglón donde escribís termina en
`TRAGOS RUTA40>`.

### Por qué a veces el mismo comando se escribe distinto

En tu máquina conviven dos terminales:

- **PowerShell** — la que trae Windows. **Es la que te conviene usar.**
- **Git Bash** — vino instalada con Git. Usa la sintaxis de Linux.

Las diferencias que más molestan:

| Para... | PowerShell (usá esta) | Git Bash |
|---|---|---|
| Ejecutar un programa de la carpeta actual | `.\pocketbase.exe` | `./pocketbase` |
| Separar carpetas | `pb\verificar.mjs` | `pb/verificar.mjs` |
| Encadenar dos comandos | `cd pb; .\pocketbase.exe` | `cd pb && ./pocketbase` |

**Regla práctica:** si te paso un comando que empieza con `./` y PowerShell
contesta *"no se reconoce como un comando"*, dá vuelta la barra: `.\`

### Glosario

| Palabra | Qué es *en este proyecto* |
|---|---|
| **PocketBase** | El servidor. Un solo archivo `.exe` que guarda todos los datos y se los sirve a las tablets por la red WiFi. Es la base de datos y la API juntas |
| **Node** (Node.js) | Un programa que ejecuta archivos JavaScript fuera del navegador. Acá se usa **solo** para correr `verificar.mjs`. El sistema en el local NO lo necesita |
| **Terminal / consola** | La ventana negra donde se escriben comandos |
| **PowerShell** | La terminal que trae Windows |
| **Schema** | La forma de la base: qué tablas hay, qué campos tiene cada una, y quién puede leer o escribir qué |
| **Migración** | Un archivo que describe un cambio del schema. Se corre y la base queda con esa forma. Sirve para que la notebook de casa y el server del local tengan exactamente lo mismo, sin tocar nada a mano |
| **Seed** | Datos de prueba que se cargan solos: los 3 usuarios y los 12 productos |
| **API** / **endpoint** | La dirección a la que las pantallas le piden datos al servidor. Ej: `/api/collections/productos/records` |
| **Regla de acceso** | La condición que decide si alguien puede ver o tocar algo. Ej: *"el barman no ve órdenes en borrador"* |
| **Commit** | Una foto guardada del proyecto, con fecha y descripción |
| **Push** | Subir esas fotos a GitHub |
| **`.cmd`** | Archivo de Windows que ejecuta comandos con doble clic |
| **Hook** | Código que corre **dentro** del servidor cuando pasa algo (ej: al cobrar una orden). Es lo que falta para que las reglas no dependan de las pantallas |

### Si algo falla

| Lo que ves | Qué pasó | Qué hacer |
|---|---|---|
| `verificar.cmd` dice `FALLA el server responde` | El servidor no está prendido | Doble clic en `arrancar.cmd` primero, después reintentá |
| La ventana negra dice `address already in use` | Ya había un servidor corriendo | Ya estaba prendido. Cerrá esta ventana y listo |
| `node no se reconoce como un comando` | Falta Node.js en la máquina | Instalalo de <https://nodejs.org>. Es solo para verificar: el sistema funciona igual sin él |
| `verificar` termina con `3 fallas` (o cualquier número) | Alguna regla del schema se rompió | Copiá las líneas rojas que dicen `FALLA` y pegámelas en el chat |
| La ventana se abre y se cierra sola de golpe | El `.cmd` falló antes de llegar al `pause` | Abrí PowerShell en la carpeta y ejecutalo desde ahí para poder leer el error |
| `pocketbase.exe no se reconoce` | Falta el ejecutable en `pb\` | Bajalo siguiendo `pb/README.md`. No está en el repo a propósito (33 MB) |

Para mirar el schema a ojo, con el servidor prendido:
<http://127.0.0.1:8090/_/> — usuario `admin@ruta40.local`.

---

## 🤖 Qué modelo usar en cada bloque

**Dónde se cambia:** el selector de modelo de la app (el control que muestra el
modelo actual, cerca del cuadro donde escribís). En una terminal `claude`
interactiva el comando es `/model`.

**Cambiar de modelo no corta la conversación.** Seguís en el mismo hilo, con
todo el contexto. Podés cambiar en la mitad de un bloque sin perder nada.

### La regla, en una pregunta

> **Si esto sale mal, ¿cuándo me entero?**
>
> - **Al toque, mirando la pantalla** → Sonnet 5
> - **A las 6 de la mañana cuando no cierra la caja**, o **solo cuando hay dos
>   barmans tocando el mismo trago** → Opus 5

Un botón que quedó torcido se ve. Un `precio_unit` que se recalculó no se ve
hasta el arqueo. Esa es toda la diferencia.

Segunda regla, por si la primera no alcanza: **¿cuántos archivos hay que tener
en la cabeza al mismo tiempo?** Uno o dos → Sonnet. Cinco con reglas que se
cruzan → Opus.

### Bloque por bloque

| Bloque | Modelo | Cambiás de vuelta cuando... |
|---|---|---|
| Diseño, decisiones, briefs (Claude Chat) | **Opus 5** | Nunca. Esta parte es puro decidir |
| `[HOOKS]` — precio congelado, número de orden, derivación de estado, transiciones válidas | **Opus 5** | `verificar.mjs` pasa en 0 fallas **con los hooks puestos** |
| `[CLAIM-TIMEOUT]` — devolver a `pendiente` el trago abandonado | **Opus 5** | El test de dos barmans simultáneos sobre el mismo item pasa |
| `caja.html`, `barra.html` — layout, listas, botones, render | **Sonnet 5** | Todo el bloque. No cambies |
| CSS, `manifest.json`, Service Worker | **Sonnet 5** | Todo el bloque |
| Plan B — impresora térmica, carga manual | **Sonnet 5** | Todo el bloque |
| Revisión final antes de commitear algo que toca plata o estados | **Opus 5** | Una sola pasada y volvés |
| Un bug raro que no entendés | **Opus 5** | Cuando se entendió qué pasaba. La corrección la puede hacer Sonnet |

### El protocolo, resumido

```
Opus  →  brief y diseño del bloque
  ↓
Sonnet →  el grueso: escribir lo que ya está decidido
  ↓
Opus  →  una pasada de revisión, solo si toca plata o estados
```

### Dónde no coincido del todo con la recomendación del Chat

El Chat puso `[HOOKS]` dentro de *"el grueso: CRUD, pantallas, PocketBase →
Sonnet"*. **Yo lo saco de ahí y lo paso a Opus.** Los hooks no son CRUD: son la
máquina de estados y las reglas de la plata metidas en el servidor. Fallan
exactamente igual de silenciosas que el claim con timeout.

El lado bueno: hacer `[HOOKS]` bien y primero es lo que **vuelve segura toda la
UI para Sonnet**. Si el servidor ya rechaza las transiciones inválidas y congela
los precios él solo, las pantallas pasan a ser "mostrar y mandar", que es
justo donde Sonnet rinde y te estira los límites semanales.

### Aviso honesto

Esto es criterio por **forma de la tarea** — cuánto contexto hay que sostener y
qué tan silencioso es el error — no una medición sobre este código. Si un bloque
con Sonnet te sale raro dos veces seguidas, pasalo a Opus y no lo pienses más:
sale más barato que un arqueo que no cierra.

---

## 🚀 Cómo arrancar la próxima sesión

1. Leer `CLAUDE.md` (convenciones, estructura, NO ROMPER, stack)
2. Leer `docs/MODELO-DATOS.md` (tablas, estados, reglas duras)
3. Leer este archivo completo
4. Si hay tarea específica: preguntar qué quiere atacar
5. Si no hay tarea: ofrecer la lista de pendientes de abajo

### Pendientes

1. `[HOOKS]` — **esperando decisión del Chat.** El diagnóstico con los 9
   agujeros medidos y las 3 opciones está en
   [`DECISION-HOOKS.md`](DECISION-HOOKS.md). Recomendación de Code: opción C
   (híbrido), y antes que la UI. Nada de esto se implementa hasta que vuelva el
   brief.
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
