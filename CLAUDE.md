# CLAUDE.md — Sistema de Tragos

> Este archivo lo lee Claude Code automáticamente al abrir una sesión en este repo.
> Contexto, convenciones y reglas. Si cambiás algo importante, actualizá este archivo.

## 📚 Documentación

| Si tu pregunta es sobre... | Leé |
|---|---|
| Tablas, estados de la orden, reglas del modelo | [`docs/MODELO-DATOS.md`](docs/MODELO-DATOS.md) |
| Decisiones tomadas, bugs, evolución | [`docs/HISTORIA.md`](docs/HISTORIA.md) |
| Cómo arrancar, verificar, qué significa cada palabra | [`docs/HISTORIA.md`](docs/HISTORIA.md) § Manual de operación |
| Qué modelo usar en cada bloque de trabajo | [`docs/HISTORIA.md`](docs/HISTORIA.md) § Qué modelo usar |
| Instalar PocketBase en una máquina nueva | [`pb/README.md`](pb/README.md) |
| Qué falta blindar en el servidor y por qué | [`docs/DECISION-HOOKS.md`](docs/DECISION-HOOKS.md) ⏸ esperando decisión del Chat |

---

## 🎯 Qué es este proyecto

Sistema de compra y despacho de tragos para **[NOMBRE DEL LOCAL]**, boliche en
Comodoro Rivadavia, Chubut.

Separa tres roles que hoy hace una sola persona:

- **Cliente** — arma su pedido
- **Cajero** — cobra y confirma
- **Barman** — prepara y entrega

El barman NO toca plata. Esa es la razón de existir del sistema: separar cobro
de despacho es control interno, no comodidad.

**Dueño / decisor:** Alejo Bello.

---

## ⚠️ RESTRICCIÓN CENTRAL — todo corre offline

El local tiene señal celular débil, y con gente adentro la celda se satura.
**El sistema no puede depender de internet para operar.**

- Servidor local (notebook vieja o Raspberry Pi) corriendo en el local
- Router / AP de grado comercial, red WiFi dedicada SIN salida a internet
- Los dispositivos hablan entre sí por LAN
- Sincronización a la nube (si algún día se hace) es al cierre del turno, nunca durante

**No proponer Supabase, Firebase, Vercel ni nada cloud para el path operativo.**
Si una feature necesita internet para funcionar durante la noche, está mal diseñada.

---

## 🛠️ Stack

| Pieza | Herramienta | Notas |
|---|---|---|
| Backend | PocketBase | Un solo ejecutable, SQLite embebido, realtime nativo, admin UI incluida |
| Frontend | HTML + JS vanilla + CSS | Sin frameworks, sin build step |
| PWA | Service Worker | Cachea el menú y el shell para tolerar cortes del server |
| Red | AP comercial (UniFi / TP-Link EAP) | Un router hogareño se cae con 50 clientes concurrentes |

---

## 📂 Estructura de archivos

```
tragos/
├── .gitignore
├── arrancar.cmd            ← Doble clic: prende el servidor
├── verificar.cmd           ← Doble clic: corre los 52 chequeos del schema
├── pb/                     ← PocketBase (ejecutable + pb_data + pb_migrations)
│   ├── pocketbase(.exe)    ← v0.40.1. NO commitear (33 MB) — ver pb/README.md
│   ├── pb_data/            ← SQLite. NO commitear
│   ├── pb_migrations/      ← Schema versionado. SÍ commitear
│   ├── pb_hooks/           ← Reglas de negocio del server (todavía no existe)
│   ├── verificar.mjs       ← Suite de chequeos del schema (node, sin deps)
│   └── README.md           ← Cómo instalar y arrancar PocketBase
├── web/
│   ├── caja.html           ← Pantalla del cajero
│   ├── barra.html          ← Pantalla del barman
│   ├── cliente.html        ← Auto-pedido (fase 2, no MVP)
│   ├── sw.js               ← Service Worker (versionado manual)
│   ├── manifest.json
│   ├── js/
│   │   ├── pb.js           ← Cliente PocketBase + helpers de conexión
│   │   ├── estados.js      ← Máquina de estados de orden e items
│   │   ├── caja.js
│   │   └── barra.js
│   └── css/
│       └── styles.css
└── docs/
    ├── MODELO-DATOS.md
    ├── HISTORIA.md
    └── DECISION-HOOKS.md  ← Decisión abierta, va al Chat
```

`web/` está vacío a propósito: el Bloque 1 fue solo backend.

---

## 🚫 NO ROMPER

1. **`precio_unit` se copia al item al momento de cobrar.** Nunca se lee del
   producto al renderizar una orden vieja. Si se rompe esto, el arqueo de caja
   no cierra nunca.
2. **`eventos` es append-only.** No se edita, no se borra. Es el registro
   contable, no un log de debug.
3. **Nada llega a la barra sin pasar por `cobrada`.** Un pedido en `borrador`
   es invisible para el barman.
4. **El estado real vive en el item, no en la orden.** El estado de la orden se
   deriva de sus items.
5. **`numero` de orden es corto (1-999) y resetea por turno.** El `id` interno
   es UUID pero nunca se le muestra a nadie: no se puede gritar un UUID por
   encima de la música.

---

## ⚙️ Convenciones

### Estilo
- 2 espacios de indent
- `let` / `const` en todo el proyecto. NO usar `var` (proyecto nuevo, sin legado)
- Strings con comilla simple `'` salvo cuando contienen `'`
- Castellano en nombres de tablas, campos y funciones de dominio
  (`crearOrden`, `marcarListo`). Inglés solo para utilidades genéricas.

### Service Worker
**Cada vez que tocás un HTML, JS o CSS de `web/` → bumpear `CACHE_VERSION` en `sw.js`.**
Si no, las tablets siguen viendo la versión vieja.

### Commits
```
<tipo>(<scope>): <descripción corta en castellano>

<cuerpo opcional>
```
Tipos: `feat`, `fix`, `chore`, `style`, `perf`, `docs`, `refactor`.

### Migraciones
Todo cambio de schema va como migración en `pb/pb_migrations/`. Nunca a mano
desde el admin UI sin exportar la migración después.

**Después de tocar el schema → correr `node pb/verificar.mjs`.** Tiene que cerrar
en 0 fallas. Si agregaste una regla nueva, agregale un chequeo.

### Nombres en la API vs. el modelo
Un par de cosas no se llaman igual que en `MODELO-DATOS.md`, por cómo funciona
PocketBase. El porqué está en `docs/HISTORIA.md` § decisiones 5 y 6.

| En el doc | En la API | Nota |
|---|---|---|
| `staff.pin` | `staff.password` | Campo nativo de auth, hasheado por PB. Mín. 4 |
| — | `staff.usuario` | La identidad de login. NO se usa email |
| `created_at` | `created_at` | Son campos `autodate` propios, no los `created`/`updated` de PB |

---

## 🔁 REGLA DEL LOOP DE SINCRONIZACIÓN

**Al cerrar cada bloque de trabajo en Claude Code:**

1. Actualizar `docs/HISTORIA.md` con lo hecho, decisiones y bugs
2. Actualizar este archivo si cambiaron convenciones o estructura
3. **Avisarle a Alejo que re-suba `CLAUDE.md`, `HISTORIA.md` y `MODELO-DATOS.md`
   al knowledge del Proyecto en Claude Chat**

Sin el paso 3, el chat queda desincronizado y se pierde la continuidad
arquitectónica. Esta regla existe porque ya pasó en otro proyecto.

---

## 🧭 División de trabajo Chat / Code

| Va a Claude Chat | Va a Claude Code |
|---|---|
| Diagnóstico y análisis | Leer y escribir archivos |
| Diseño de arquitectura | Ejecutar el brief |
| Elegir entre dos caminos | Migraciones, commits, deploy |
| Escribir el brief | Verificar contra el código real |

**Test:** si la respuesta depende de leer un archivo → Code. Si depende de
elegir entre dos caminos → Chat primero.

Claude Code no toma decisiones de arquitectura sin brief. Si aparece un
rediseño grande en medio de una tarea, se frena y vuelve al Chat.

---

## 🗣️ Trato

- Castellano rioplatense, vos (no usted)
- Respuestas concisas
- Explicar visualmente cuando se proponga un cambio
- Emojis con moderación en respuestas, NO en código salvo pedido
- Avisar el riesgo antes de cambios grandes, y dar opciones

### ⚠️ Alejo no programa. Instrucciones ejecutables, no aproximadas.

Esto no es opcional: es la diferencia entre que pueda seguir el proyecto o no.

1. **Siempre decir DÓNDE se escribe cada cosa.** No alcanza con
   "corré `node pb/verificar.mjs`". Va: *"doble clic en `verificar.cmd`"*, o
   *"abrí PowerShell en la carpeta del proyecto y escribí esto"*. Los tres
   lugares posibles (chat / terminal / doble clic) están en
   `docs/HISTORIA.md` § Manual de operación.
2. **Comandos en sintaxis PowerShell**, que es la terminal de su máquina.
   `.\archivo.exe` y `pb\archivo.js`, no `./archivo` ni `pb/archivo.js`.
   Si un bloque es para Git Bash, aclararlo arriba.
3. **Decir qué tiene que ver en pantalla si salió bien.** Pegar la salida
   esperada, no solo el comando.
4. **No dar por sabido el vocabulario.** Node, npm, endpoint, hook, migración,
   seed, commit: la primera vez que aparecen en una respuesta, una frase de
   qué son. El glosario vive en `docs/HISTORIA.md` § Manual de operación —
   si aparece una palabra nueva, agregarla ahí.
5. **Preferir el doble clic a la terminal** cuando se pueda. Si una tarea se va
   a repetir, envolverla en un `.cmd` en la raíz (ver `arrancar.cmd`).
   Los `.cmd` se guardan **con CRLF y sin acentos en los `echo`** — ver
   `docs/HISTORIA.md` § Gotchas de Windows.
6. **Si algo falla, dar la tabla de "qué ves → qué hacer"**, no un stack trace
   suelto.
