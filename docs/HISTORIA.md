# HISTORIA — Sistema de Tragos

> Decisiones tomadas, bugs significativos y evolución del proyecto.
> Esto es el "por qué" detrás del código. Si volvés en 6 meses, leé esto antes
> de tocar nada.
>
> **Lo llena Claude Code al cerrar cada bloque de trabajo.**

---

## 📅 Línea de tiempo

>CLCODE<

| Período | Hito |
|---|---|
| Ago 2026 | Diseño del modelo de datos y la máquina de estados (Claude Chat). Repo vacío. |
| 24 ago 2026 | **Bloque 1** — esqueleto del repo, PocketBase v0.40.1, schema de las 6 colecciones, reglas por rol, seed y suite de verificación. Sin UI. |
| 24 ago 2026 | **Bloque 1b** — `arrancar.cmd` y `verificar.cmd` (doble clic, sin terminal), manual de operación y guía de qué modelo usar en cada bloque. |
| 25 ago 2026 | **Bloque 2** — push inicial a GitHub. Diagnóstico de `[HOOKS]`: 9 agujeros medidos contra el servidor real y 3 opciones de arquitectura. **Frenado a propósito**: la decisión va al Chat. Ver [`DECISION-HOOKS.md`](DECISION-HOOKS.md). |
| 25 ago 2026 | **Bloque 3** — `[HOOKS]` implementado según [`BRIEF-HOOKS.md`](BRIEF-HOOKS.md). Los 9 agujeros cerrados, `[CLAIM-TIMEOUT]` andando. La suite pasó de 52 a **92 chequeos, 0 fallas**. |
| 25 ago 2026 | **Bloque 4** — `caja.html` y `barra.html` andando, con realtime. Probadas de punta a punta en el navegador: cobro, número gritable, tablero de la barra, anulación y caída del servidor. Sin PWA todavía. |
| 25 ago 2026 | **Bloque 5** — red de seguridad contra el realtime zombi, latencia medida (**27 ms**), y `gestion.html`: el jefe edita su menú y sus precios sin tocar el panel técnico. |
| 25 ago 2026 | **Bloque 6** — `panel.html`: reportes para el dueño (venta por hora, ranking de tragos, aviso de silencio). Cerró la duda de "varios locales": lo que pedía Alejo no era eso. Ver `DECISION-MULTILOCAL.md`. |
| 26 ago 2026 | **Bloque 7 — [PODA]** — brief del Chat. Se saca `cantidad` (una fila por trago), la orden pasa de 6 estados a 3, `metodo_pago` obligatorio, y `grupo`/`etiqueta` para los vasos de ½ L y 1 L. La suite pasó de 92 a **111 chequeos, 0 fallas**. |

---

## 🏛️ Decisiones de arquitectura

### 1. Todo offline, sin cloud en el path operativo

>CLCHAT<

**Estado:** decidido, no negociable.

**Por qué:** el local tiene señal celular débil y con gente adentro la celda se
satura. Un sistema que depende de la nube se cae justo en el pico de venta.

**Implicancia:** PocketBase local en vez de Supabase. Red WiFi dedicada sin
salida a internet. Sync a la nube (si se hace) es al cierre, nunca durante.

### 2. El barman no toca plata

>CLCHAT<

**Estado:** decidido, es la razón de existir del sistema.

**Por qué:** el barman que cobra es la fuga de caja número uno en gastronomía
nocturna. Separar cobro de despacho es control interno, no comodidad.

**Implicancia:** la transición `borrador → cobrada` es el único portón hacia la
barra. Ver `MODELO-DATOS.md` § "Reglas duras".

### 3. Estado en el item, no en la orden

>CLCHAT<

**Estado:** decidido.

**Por qué:** un pedido de 4 tragos puede tener 2 listos y 2 en preparación, con
dos barmans trabajando en paralelo sobre la misma orden.

**Implicancia:** el estado de la orden se deriva de sus items. No se escribe a
mano.

### 4. MVP sin auto-pedido del cliente

>CLCHAT<

**Estado:** decidido para la primera noche.

**Por qué:** el cuello de botella real es la caja, no la barra. Y hay que medir
cuánto tarda un barman por trago antes de sumarle variables. El auto-pedido va
en fase 2.

---

### 5. `staff` es una auth collection de PocketBase; el PIN es el `password`

>CLCODE<

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

>CLCODE<

**Estado:** decidido, es seguridad.

**Por qué:** PocketBase crea una colección `users` con `createRule = ""`, o sea
registro público abierto. Cualquiera conectado a la WiFi del local podía
auto-registrarse y quedar autenticado — y todas nuestras reglas de lectura
arrancan con `@request.auth.id != ""`. Habría leído el menú, los turnos y los
eventos. La migración inicial la borra.

### 7. El ejecutable de PocketBase no va al repo

>CLCODE<

**Estado:** decidido.

**Por qué:** 33 MB por binario y uno distinto por SO (la notebook de desarrollo
es Windows, el server del local va a ser Linux/ARM). Va en `.gitignore`, con las
instrucciones de descarga en `pb/README.md`. Lo que SÍ se versiona es
`pb/pb_migrations/`: el schema completo se reconstruye con `migrate up`.

---

### 8. El reloj del server es un riesgo de hardware sin resolver

>CLCHAT<

**Estado:** abierto. **Decidir antes de comprar la Raspberry Pi.**

**Por qué:** una Raspberry Pi no tiene reloj de hardware con pila. Sin internet
no hay NTP, así que arranca con la hora donde la dejó, o en 1970. Eso rompe el
cron del timeout, `cobrada_at`, `entregada_at` y todo el recuento por hora —
o sea, media razón de existir del sistema.

**Opciones:** un módulo RTC (barato, se suelda a los pines) o usar la notebook
vieja, que ya tiene pila. La notebook además evita el problema de raíz y no
cuesta nada.

**Implicancia:** hasta que esto se decida, no comprar hardware.

---

## 🐛 Bugs significativos

*(vacío — se llena cuando aparezcan)*

### Gotchas de PocketBase que ya nos mordieron

>CLCODE<

- **Una regla de `list` no da 403, filtra.** Si no matchea, PocketBase devuelve
  `200` con la lista vacía, no un error. Al testear permisos de lectura hay que
  chequear `totalItems === 0`, no el status code.
- **Una regla de `update`/`delete` que no matchea da `404`, no `403`** — para no
  filtrar si el registro existe.

### Gotchas de los hooks de PocketBase (Bloque 3)

>CLCODE<

Estos cinco costaron toda una sesión. Están en orden de cuánto cuesta
descubrirlos, porque **ninguno da un error que te apunte al problema**.

1. **El archivo tiene que llamarse `*.pb.js`.** Un `main.js` común no se carga
   y **el server arranca sin decir una palabra**. Se descubre porque los
   endpoints dan 404 y no hay ni un log. Se confirma buscando `.pb.js` adentro
   del binario.
2. **Cada handler corre en su propio runtime de JS.** No ve funciones ni
   constantes declaradas afuera, en el mismo archivo. Todo se trae con
   `require()` **adentro** del handler. Por eso
   `utils.js` NO termina en `.pb.js`: es un módulo, no un hook.
3. **Por lo mismo, no pasarle callbacks propios a funciones del módulo.** Un
   wrapper tipo `responder(e, () => {...})` falla raro. El `try/catch` va
   inline en cada handler.
4. **`runInTransaction` devuelve `void`** y su callback recibe `txApp`. Hay que
   usar `txApp` adentro (no `$app`), guardar el resultado en una variable de
   afuera, y responder **después** de que la transacción cierre.
5. **Un campo `date` vacío NO es `null`:** es un `DateTime` cero, y en JS todo
   objeto es *truthy*. `if (turno.get("cerrado_at"))` da `true` **siempre**.
   Se chequea con `.isZero()` — está envuelto en `utils.sinFecha()`.

**Y uno que no es de PocketBase pero disfrazó de bug lo que no lo era:**
`JSON.stringify` **borra las claves cuyo valor es `undefined`**. Un turno que
quedó abierto de una corrida anterior hacía fallar la creación del turno nuevo,
`turno.id` quedaba `undefined`, y el endpoint contestaba *"Falta orden_id"* —
un mensaje que apuntaba al lugar equivocado. Por eso `verificar.mjs` ahora
**limpia la base antes de empezar**, no sólo al final.

### Gotchas de Windows que ya nos mordieron

>CLCODE<

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

>CLCODE<

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

>CLCODE<

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

### Bloque 3 — `[HOOKS]` implementado (25 ago 2026)

>CLCODE<

**Brief:** [`BRIEF-HOOKS.md`](BRIEF-HOOKS.md), decidido en Claude Chat. Opción C
corrida: híbrido con `claim` del lado de las operaciones.

**Qué se hizo:**

- `pb/pb_hooks/main.pb.js` — 3 endpoints (`cobrar`, `claim`, `anular`), las
  guardas de `orden_items` / `ordenes` / `turnos`, la derivación del estado de
  la orden y el cron del timeout.
- `pb/pb_hooks/utils.js` — helpers. **No termina en `.pb.js` a propósito**: es
  un módulo que los handlers traen con `require()`, no un hook.
- Migración `1787644800_lock_eventos.js` — `eventos.createRule = null`. Ya nadie
  escribe eventos desde afuera: los escribe el server.
- Migración `1787648400_eventos_staff_opcional.js` — `staff_id` pasa a opcional.
- `verificar.mjs` reescrito: **92 chequeos, 0 fallas**.

**Los 9 agujeros del diagnóstico, cerrados y con prueba que lo demuestra:**

| # | Antes pasaba | Ahora |
|---|---|---|
| 1 | Vender en un turno cerrado | Rechazado al crear la orden y al cobrar |
| 2 | Cobrar sin congelar el precio | Imposible: el server lo copia del producto |
| 3 | Total inventado | El `total` del body se **ignora**, lo suma el server |
| 4 | Saltar `pendiente` → `entregado` | Sólo transiciones válidas |
| 5 | Reescribir el precio de una orden cobrada | `precio_unit` inmutable fuera de borrador |
| 6 | Pisar el claim de otro barman | `barman_id` no se pisa; el claim es atómico |
| 7 | Anular sin motivo ni evento | Motivo obligatorio de una lista cerrada, evento automático |
| 8 | Orden que miente sobre sus items | El estado se deriva, no se escribe |
| 9 | Dos turnos abiertos | Rechazado al crear y al actualizar |

**Dos corrimientos del brief respecto de lo que había recomendado Code, ambos
acertados:**

1. **`claim` como operación, no como guarda.** Una guarda lee `barman_id` vacío
   y *después* escribe; en el medio entra el otro barman y los dos pasan. La
   prueba [54] dispara dos claims en paralelo sin esperarse: gana uno y el otro
   recibe 409 con el nombre del que ganó.
2. **La pantalla nunca escribe en `eventos`.** Los escribe el server en cada
   operación. Eso volvió el agujero 7 imposible en vez de improbable.

**Un cambio de schema que no estaba en el brief:** `eventos.staff_id` pasó a
opcional. El evento `timeout` lo genera el cron, no una persona; con el campo
obligatorio el cron devolvía el trago a `pendiente` pero fallaba al escribir el
evento, y el registro contable quedaba con un agujero justo en el caso que más
interesa auditar. Los eventos con autor lo siguen guardando siempre.

**Decisiones de operación que contestó Alejo** (delegó el criterio):
turno = ciclo de caja, no horario de puertas; **cerrar el turno bloquea cobrar
pero no entregar**, así se sigue despachando lo ya vendido mientras se cierra la
caja.

**Lo que costó:** cinco comportamientos no documentados de los hooks de
PocketBase, ninguno de los cuales da un error que apunte al problema. Están
todos anotados arriba en § Gotchas de los hooks. El peor: un archivo que no se
llame `*.pb.js` **no se carga y el server no dice nada**.

---

### Bloque 4 — Las dos pantallas (25 ago 2026)

>CLCODE<

**Qué se hizo:**

- `web/caja.html` + `web/js/caja.js` — menú por categoría, carrito, cobro y
  arqueo al cerrar turno.
- `web/barra.html` + `web/js/barra.js` — tablero de tres pistas
  (cola → preparando → listos), agrupado por número de pedido.
- `web/js/pb.js` — cliente de PocketBase escrito a mano, con realtime.
- `web/js/ui.js` — login con teclado numérico, avisos, modales, indicador de
  conexión.
- `web/js/estados.js`, `web/css/styles.css`, `web/index.html`.
- `arrancar.cmd` ahora sirve `web/` con `--publicDir`.

**Probado de verdad en el navegador, no sólo escrito:** login, apertura de
turno, carga de un pedido de $25.000, cobro, número gigante, llegada a la barra
por realtime, tomar/listo/entregar, anulación con motivo, caída del servidor y
recuperación sola, y cierre de turno con arqueo.

---

### Decisiones del front

>CLCODE<

**1. Cliente de PocketBase escrito a mano, sin SDK.**
El SDK oficial viene por CDN y el local no tiene internet. Todo lo que hace
falta entra en `pb.js`. De paso queda sin dependencias ni build step, que es lo
que pide el stack.

**2. El carrito vive en memoria hasta que se cobra.**
Si se creara la orden al primer trago, cada cliente que se arrepiente dejaría un
`borrador` huérfano. Recién al tocar COBRAR se crea la orden con sus items y se
llama al endpoint.

**Y si el cobro se corta en el medio,** el id de la orden queda guardado en el
navegador y el siguiente intento reintenta sobre la MISMA orden. Como `cobrar`
es idempotente, no se puede cobrar dos veces por accidente. Al arrancar, la
pantalla detecta un cobro colgado y pregunta si cobrarlo o descartarlo.

**3. Cada pantalla acepta sólo ciertos roles.**
`caja.html` pide cajero o jefe; `barra.html` pide barman o jefe. El servidor ya
lo rechazaría, pero no hay que ofrecerle a un cajero un botón "Tomar" que va a
dar 403.

**4. Una sesión por pantalla, no por dispositivo.**
Las dos pantallas comparten `localStorage`. Con una sola clave, entrar en la
barra deslogueaba la caja del mismo aparato — pasó durante las pruebas y se ve
rarísimo. Ahora la clave incluye el nombre de la pantalla.

**5. El realtime respeta el portón.**
Se midió: mientras la orden está en `borrador`, la barra no recibe **ningún**
evento. Las reglas de acceso se aplican también al stream, así que el portón no
depende de que la pantalla filtre bien.

**6. Aviso de caída bien visible.**
Si el server no responde, aparece una franja roja: *"SIN CONEXIÓN CON EL
SERVIDOR — pasá al talonario de papel"*. Es la conexión con el Plan B: el cajero
tiene que enterarse en el momento, no cuando no cierre el arqueo. Vuelve sola
cuando el server revive, sin recargar.

**7. Si el SSE no levanta, sondeo cada 3 segundos.**
Una tablet vieja no puede dejar a la barra sin ver pedidos.

---

## ⏱️ Qué tan rápido llega un pedido a la barra

>CLCODE<

**Medido el 25 ago 2026**, no estimado. 10 cobros reales, cronometrando desde
que la caja manda el cobro hasta que el trago aparece dibujado en la pantalla
del barman.

| | milisegundos |
|---|---|
| Más rápido | 21 |
| **Promedio** | **27** |
| Mediana | 25 |
| Más lento | 43 |

Llegaron **10 de 10**. Para tener referencia: un parpadeo son unos 100 ms.

**Ojo con lo que esto mide y lo que no.** Se midió en una sola notebook, contra
`127.0.0.1`, sin WiFi de por medio. O sea: **27 ms es lo que tarda el sistema**,
y lo que falta medir es lo que agrega la red del local. En una LAN decente son
unos pocos milisegundos más; el número grande va a depender del access point,
no del código. **Esa medición hay que rehacerla en el local**, y está anotada
como pendiente.

### Qué pasa si el aviso NO llega

Tres capas, de la más rápida a la más lenta:

| Si falla... | Qué lo salva | Cuánto tarda |
|---|---|---|
| Nada. Todo normal | El aviso instantáneo del server | **27 ms** |
| El aviso se corta y el navegador se da cuenta | Cambia a preguntar cada 3 segundos | **hasta 3 s** |
| El aviso queda "zombi" (la conexión sigue abierta pero no llega nada) | La barra pregunta igual cada 15 s | **hasta 15 s** |
| El servidor se cayó | Franja roja en las dos pantallas | **hasta 5 s en verse** |

La tercera fila es la importante y **era un agujero real hasta el 25 ago**: la
barra sólo volvía a preguntar cuando el server le avisaba. Si el aviso moría en
silencio, mostraba una cola vieja para siempre y nadie se enteraba — un trago
pagado que nadie prepara. Ahora pregunta cada 15 segundos pase lo que pase.

Se verificó: **6 recargas solas en 90 segundos, exactamente cada 15,0 s**, sin
tocar nada.

### Y para que no haya que confiar a ciegas

La barra muestra en la cabecera **cuán fresco es lo que estás viendo**: dice
"al día" si los datos son de hace menos de 20 segundos, y si pasa de 30 se pone
en rojo con el tiempo real. El barman puede **mirar** y saber si la pantalla
está viva, sin depender de que alguien le avise.

---

### Bloque 5 — Confiabilidad y el menú del jefe (25 ago 2026)

>CLCODE<

**Disparado por dos preguntas de Alejo:** *"¿cómo certificamos que es rápido?"*
y *"¿qué pasa si el cliente compra pero no le llega al barman?"*.

**Lo que encontró la segunda pregunta:** un agujero real. La barra sólo volvía a
pedir los pedidos **cuando el server le avisaba**. Si ese aviso moría en silencio
—la conexión sigue abierta pero deja de llegar nada, que no dispara ningún
error— la barra mostraba una cola vieja para siempre. Un trago pagado que nadie
prepara. Arreglado: ahora pregunta cada 15 segundos pase lo que pase, y muestra
en la cabecera cuán fresco es lo que se ve.

**Lo que contestó la primera:** ver § Qué tan rápido llega un pedido a la barra.
27 ms de promedio, medidos.

**`gestion.html` — el menú del jefe.** Agregar tragos, cambiar precios,
reordenar, y apagar un producto de un toque cuando se acaba. No hace falta
migración: el schema ya tenía `createRule`/`updateRule` en `rol = "jefe"`.

**Borrar no existe a propósito.** `deleteRule` es `null` para todos: un producto
borrado dejaría huérfanas las ventas viejas que lo referencian. Se apaga, no se
borra.

**Lo que hace seguro que el jefe toque precios en plena noche** es NO ROMPER #1:
`precio_unit` se congela al cobrar. Se verificó explícitamente — se vendieron 2
Fernet a $8.000, el jefe subió el Fernet a $15.000, y la venta vieja siguió
valiendo $16.000. Un cajero, además, no puede cambiar precios.

---

### Bloque 6 — El panel del dueño (25 ago 2026)

>CLCODE<

**De dónde salió:** Alejo le llevó a Claude Chat la pregunta de "varios
locales" de `DECISION-MULTILOCAL.md`, y al contestarla quedó claro que lo que
quería en realidad no era eso — era un panel de reportes para un solo local.
Ver el cierre de esa decisión en el propio archivo.

**Las tres preguntas que pidió Alejo, contestadas con datos que YA existían:**

- *¿A qué hora se vende más?* — gráfico de barras por hora, sumando
  `ordenes.total` agrupado por la hora de `cobrada_at`.
- *¿Qué trago sale más esa noche?* — ranking por `orden_items.nombre_snapshot`,
  sumando `cantidad`.
- *¿Hace cuánto que no se vende nada?* — minutos desde la venta más reciente
  del turno abierto. Pasados 20 minutos, aparece un aviso.

**Sin migración.** Todo esto ya estaba guardado desde el Bloque 1: cada venta
graba su hora, y cada item guarda el nombre del trago al momento de cobrar.
El panel sólo lee y agrupa, no agrega ningún dato nuevo.

**Por qué el ranking y el total de $ dan resultados distintos con un mismo
trago anulado:** se probó a propósito. Se vendieron 6 Fernet, 3 Gin Tonic y 1
Vodka con Speed, y el Vodka se anuló después. El total en pesos SIGUE contando
esa venta ($8.500): la caja ya cobró esa plata, y `total` de la orden es
inmutable una vez cobrada (NO ROMPER #1). Pero el **ranking de tragos** excluye
los items anulados a propósito: no tiene sentido para el dueño ver como "el
que más salió" un trago que en realidad nunca llegó a la mesa.

**Se prueba en la misma WiFi, no en la nube.** El panel es una pantalla más
del local (como caja o barra), no algo que se mira desde afuera. Es la
diferencia entre esto y B2 en `DECISION-MULTILOCAL.md`: ver reportes desde
adentro no necesita internet; verlos desde la casa sí, y eso es un problema
distinto que no se resolvió acá.

**Límite conocido, no un agujero nuevo:** un barman ya podía leer
`ordenes`/`orden_items` completos desde antes (los necesita para ver su
propia cola en `barra.html`), así que técnicamente ya tenía acceso a los
mismos números que ve el panel. El login de `panel.html` que exige rol
`jefe` es una comodidad de pantalla, no un candado nuevo sobre esos datos —
PocketBase no filtra campo por campo, sólo registro completo. Si en algún
momento hace falta ocultarle la plata al barman, hay que armar un endpoint de
reportes en `pb_hooks/` (como `cobrar`), no una regla de colección.

---

### Bloque 7 — [PODA]: simplificar el modelo (26 ago 2026)

>CLCHAT<

**Brief del Chat.** Sacar del modelo lo que estaba duplicado o mal ubicado,
antes de que se acumulara más código encima.

**Los cambios que entraron:**

| # | Qué | Por qué |
|---|---|---|
| 1 | `orden_items.cantidad` se va | Con 3 en una fila, esa fila no puede tener UN estado. Contradecía NO ROMPER #4 |
| 2 | `ordenes.estado`: 6 → 3 valores | `en_preparacion` y `lista` eran copia del estado de los items. `descartada` se reemplaza por borrar |
| 3 | `metodo_pago` obligatorio | Sin método no hay arqueo de efectivo |
| 4 | `grupo` + `etiqueta` en productos | Vaso de ½ L y de 1 L como un botón partido. **Sólo visual** |
| 5 | Seed con el par de vasos | Ejemplo vivo de cómo se usa |
| 6 | Fecha del turno = `abierto_at` − 6 h | Documentado, NO implementado (va en `cobrar`) |
| 7 | Turno único + auto-apertura | Único ✅ ya estaba. Auto-apertura documentada, NO implementada |
| 8 | `[CLAIM-TIMEOUT]` | **NO se pospuso.** Ver abajo |

**Lo que demuestra por qué valía la pena el punto 1:** se probó en el navegador
cobrando 3 Fernet + 1 Gin. Quedaron 4 filas separadas. Después, desde la barra,
se tomaron los 3 Fernet juntos y se marcó **uno solo** como listo: quedó 1
listo y 2 todavía preparándose. Con el modelo viejo eso era imposible de
representar.

---

### El brief venía desfasado del repo, y hubo que frenarlo

>CLCODE<

El brief decía *"se simplifica el modelo **antes** de escribir los hooks"* y se
titulaba "Bloque 3". Pero los hooks eran el Bloque 3 real, cerrado hacía dos
bloques, con 92 chequeos en verde. El Chat estaba mirando una foto vieja del
proyecto (probablemente de antes de que Alejo subiera el commit del Bloque 3).

La señal más clara: el punto 8 pedía posponer `[CLAIM-TIMEOUT]` y "no
implementar el cron" — pero el cron ya estaba corriendo, con su propia prueba
pasando ([55] en `verificar.mjs`).

**Por qué eso importaba y no era un detalle:** el brief pedía *sólo migración,
sin tocar `pb_hooks/` ni `web/`*, y a la vez exigía cerrar en 0 fallas. Con el
repo real, las dos instrucciones se contradicen:

- `total += precio * item.get('cantidad')` — sin el campo, **todo pedido
  cobrado habría quedado en $0**. Justo NO ROMPER #1.
- `derivarEstadoOrden` seguía escribiendo `en_preparacion` y `lista`, valores
  que ya no existirían en el select → PocketBase rechaza el save → se rompe
  todo el flujo de la barra.
- 25 referencias a `cantidad` en las 3 pantallas.

Siguiendo `CLAUDE.md` § *"si aparece un rediseño grande en medio de una tarea,
se frena y vuelve al Chat"*, se frenó y se le presentó a Alejo el choque con
las tres opciones. Eligió hacer la migración **más** los parches mínimos.

**Y un dato del brief que no era cierto:** decía *"un borrador se borra, el
`deleteRule` ya lo permite"*. No lo permitía: `ordenes.deleteRule` era `null`,
o sea nadie podía borrar una orden. Se abrió, pero **sólo para borradores** y
sólo cajero o jefe — una orden cobrada sigue sin poder borrarse jamás.

**`[CLAIM-TIMEOUT]`: no se pospuso, a diferencia de lo que pedía el punto 8.**
El brief justificaba posponerlo con *"una sola pantalla en barra, no hay claim
entre dispositivos"*. Ese supuesto no se sostiene: el mismo día, Alejo confirmó
**3-4 barmans sobre una sola cola**, que es exactamente el escenario para el
que existe el claim. Sacar el cron habría sido perder algo ya hecho, probado y
útil para el caso real. Los campos `barman_id` y `claim_at` se quedan, como
pedía el brief, y el cron también.

---

## 🔑 Keywords

>CLCODE<

*(convención: cada feature se referencia con una keyword entre corchetes, para
poder retomarla en otra conversación. Ej: `[CLAIM-TIMEOUT]`, `[ARQUEO]`)*

- `[SCHEMA]` — las 6 colecciones y sus reglas. Bloque 1. ✅
- `[HOOKS]` — reglas de negocio en el server. Bloque 3. ✅
- `[CLAIM-TIMEOUT]` — devolver a `pendiente` un trago abandonado. Bloque 3. ✅
- `[ARQUEO]` — reportes de cierre de turno. Pendiente.
- `[STOCK]` — apagar solo un producto cuando se agota. Hoy es manual con el
  toggle `activo`. Fase 2.

---

## 🖥️ Manual de operación — paso a paso

>CLCODE<

> Escrito para que lo siga alguien que no programa. Si algo de acá no se
> entiende, el problema es el texto, no el lector: avisá y se reescribe.

### Primero: dónde se escriben las cosas

>CLCODE<

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

>CLCODE<

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
  92 OK · 0 fallas
────────────────────────────────────────────
```

Si dice **0 fallas**, el backend está sano. Si dice cualquier otro número,
copiá las líneas que digan `FALLA` y pasámelas por el chat.

La última prueba espera hasta 70 segundos, porque comprueba que el reloj interno
devuelva solo un trago abandonado. Si tenés apuro, `verificar.cmd` se puede
correr salteándola desde PowerShell con `node pberificar.mjs --rapido`.

<details>
<summary>Si preferís hacerlo por terminal</summary>

```powershell
cd "C:\Users\Alejo\OneDrive\Documentos\CLAUDE\TRAGOS RUTA40"
node pb\verificar.mjs
```
</details>

#### B2 · Abrir las pantallas

Con el servidor prendido, en la tablet (o en la notebook) abrí el navegador y andá a:

| Pantalla | Dirección |
|---|---|
| Elegir | `http://<ip-del-server>:8090` |
| Caja | `http://<ip-del-server>:8090/caja.html` |
| Barra | `http://<ip-del-server>:8090/barra.html` |

En la misma notebook del servidor, `<ip-del-server>` es `127.0.0.1`. Desde una
tablet hay que poner la IP de la notebook en la WiFi del local (algo tipo
`192.168.1.50`). Para saberla, abrí PowerShell y escribí `ipconfig`: es la
"Dirección IPv4".

Conviene **guardar la página en la pantalla de inicio** de cada tablet, así
queda como si fuera una app.

Usuarios de prueba: `caja1`/1111, `barra1`/2222, `jefe`/9999.

#### C · Apagar el servidor

Cerrás la ventana negra que abrió `arrancar.cmd`. O apretás `Ctrl+C` adentro
de ella.

### Cómo abrir una terminal parada en la carpeta correcta

>CLCODE<

Esto hace falta para git y poco más. Dos formas:

1. Explorador de Windows → entrá a la carpeta `TRAGOS RUTA40` → clic en la
   **barra de direcciones** (donde dice la ruta) → borrá lo que hay, escribí
   `powershell` y Enter.
2. `Shift` + clic derecho sobre la carpeta → *"Abrir ventana de PowerShell aquí"*.

Sabés que estás bien parado porque el renglón donde escribís termina en
`TRAGOS RUTA40>`.

### Por qué a veces el mismo comando se escribe distinto

>CLCODE<

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

>CLCODE<

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

>CLCODE<

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

>CLCODE<

**Dónde se cambia:** el selector de modelo de la app (el control que muestra el
modelo actual, cerca del cuadro donde escribís). En una terminal `claude`
interactiva el comando es `/model`.

**Cambiar de modelo no corta la conversación.** Seguís en el mismo hilo, con
todo el contexto. Podés cambiar en la mitad de un bloque sin perder nada.

### La regla, en una pregunta

>CLCODE<

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

>CLCODE<

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

>CLCODE<

```
Opus  →  brief y diseño del bloque
  ↓
Sonnet →  el grueso: escribir lo que ya está decidido
  ↓
Opus  →  una pasada de revisión, solo si toca plata o estados
```

### Dónde no coincido del todo con la recomendación del Chat

>CLCODE<

El Chat puso `[HOOKS]` dentro de *"el grueso: CRUD, pantallas, PocketBase →
Sonnet"*. **Yo lo saco de ahí y lo paso a Opus.** Los hooks no son CRUD: son la
máquina de estados y las reglas de la plata metidas en el servidor. Fallan
exactamente igual de silenciosas que el claim con timeout.

El lado bueno: hacer `[HOOKS]` bien y primero es lo que **vuelve segura toda la
UI para Sonnet**. Si el servidor ya rechaza las transiciones inválidas y congela
los precios él solo, las pantallas pasan a ser "mostrar y mandar", que es
justo donde Sonnet rinde y te estira los límites semanales.

### Aviso honesto

>CLCODE<

Esto es criterio por **forma de la tarea** — cuánto contexto hay que sostener y
qué tan silencioso es el error — no una medición sobre este código. Si un bloque
con Sonnet te sale raro dos veces seguidas, pasalo a Opus y no lo pienses más:
sale más barato que un arqueo que no cierra.

---

## 🚀 Cómo arrancar la próxima sesión

>CLCODE<

1. Leer `CLAUDE.md` (convenciones, estructura, NO ROMPER, stack)
2. Leer `docs/MODELO-DATOS.md` (tablas, estados, reglas duras)
3. Leer este archivo completo
4. Si hay tarea específica: preguntar qué quiere atacar
5. Si no hay tarea: ofrecer la lista de pendientes de abajo

### Pendientes

>CLCODE<

1. **`[TURNO-AUTO]`** — fecha del turno con −6 h y auto-apertura en el primer
   cobro. Ya documentado en `MODELO-DATOS.md`, falta el hook de `cobrar`. Es lo
   que el brief de [PODA] dejaba para el bloque siguiente.
2. **`[BOTON-PARTIDO]`** — dibujar `grupo`/`etiqueta` en `caja.html`. El schema
   quedó listo en [PODA]; falta sólo la pantalla.
3. **Service Worker + manifest (PWA).** Lo único que falta para que las tablets
   aguanten un corte del server sin quedar en blanco. **Sonnet 5.**
4. **Probar en las tablets reales, en el local, con la WiFi de verdad.** Todo
   está probado en una notebook contra `localhost`.
5. Plan B: impresora térmica y carga manual en papel.
6. **Decidir el hardware del server.** Ver el riesgo del reloj en Decisiones.
7. **La marca del local** — el nombre en las pantallas (hoy `[NOMBRE DEL LOCAL]`).

### Reglas de oro al arrancar

>CLCODE<

- Antes de cambios grandes o riesgosos: explicar el riesgo a Alejo y dar opciones
- Bumpear el SW al tocar cualquier archivo de `web/`
- Todo cambio de schema va como migración en `pb/pb_migrations/`
- Castellano rioplatense, vos
- **Al cerrar el bloque: actualizar este archivo + `CLAUDE.md` y avisarle a
  Alejo que los re-suba al Proyecto en Claude Chat**
