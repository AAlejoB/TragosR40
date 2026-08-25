# DECISIÓN PENDIENTE — varias barras / varios locales

>CLCODE<

> **Para qué es este archivo:** subilo al Proyecto en Claude Chat y decidí ahí.
> Claude Code lo escribió mirando el código y las restricciones reales, pero
> **no tocó nada**: es un cambio de fondo, no un ajuste.
>
> Escrito el 25 ago 2026, con los bloques 1 a 4 terminados.

---

## Lo primero: son dos pedidos distintos

Alejo pidió "varios locales / varias barras" como una sola cosa. **No lo son.**
Una es un cambio de tamaño mediano y la otra choca de frente con la restricción
central del proyecto. Conviene separarlas antes de discutir nada.

| | Qué es | Veredicto corto |
|---|---|---|
| **A · Varias barras** | Dos barras físicas en el mismo boliche, cada una con su cola | Se puede. Cambia el schema y hay 3 preguntas de operación sin responder |
| **B · Varios locales** | El mismo sistema sirviendo a más de un boliche | Depende de qué signifique. Una versión ya está resuelta; la otra contradice el diseño |

---

## A · Varias barras en el mismo local

### Por qué alguien lo querría

Con una sola barra, 50 personas hacen una sola fila y el cuello de botella se
mueve del cajero al barman. Dos barras (una de cerveza y tragos simples, otra de
cócteles) reparten el trabajo.

### Lo que NO cambia

- La máquina de estados: `pendiente → preparando → listo → entregado` sigue igual.
- El portón `borrador → cobrada`: igual.
- El claim, la anulación y el timeout: igual.
- Los 92 chequeos actuales: siguen valiendo.

### Lo que SÍ cambia

**Schema.** Hace falta una noción de "barra". Dos formas:

1. **Por producto** — cada producto se asigna a una barra (`productos.barra_id`).
   La cerveza va siempre a la barra 2. Es automático: el cajero no decide nada.
2. **Por item** — el cajero elige a qué barra mandar cada trago. Más flexible,
   pero le suma una decisión al cajero en el momento de más apuro. Malo.

La 1 es claramente mejor: el cajero ya tiene bastante.

**Pantalla de barra.** Cada tablet elegiría "soy la barra 1" y filtraría su cola.
Es un filtro más en la consulta que ya existe. Poco trabajo.

**Pantalla de gestión.** El jefe tendría que poder decir a qué barra va cada
producto. Un campo más en el formulario que ya existe.

### Las 3 preguntas que hay que contestar antes de tocar código

Ninguna es técnica. **Sólo las puede contestar quien conoce el local.**

1. **Un pedido con tragos de las dos barras, ¿cómo se entrega?**
   - ¿El cliente va a las dos barras con el mismo número?
   - ¿O una barra "junta" el pedido y lo entrega completo?
   - Esto cambia todo el diseño de la pantalla. Es la pregunta más importante.

2. **El número de pedido, ¿es único del local o por barra?**
   - Único del local: se puede gritar sin ambigüedad, pero las dos barras
     comparten el contador.
   - Por barra: dos clientes pueden ser el "12" al mismo tiempo. Malo si gritan.
   - *Recomendación de Code: único del local.*

3. **¿Un barman puede ayudar en la otra barra?**
   - Si sí, el filtro es una preferencia, no una restricción.
   - Si no, hay que atarlo al `staff`.

### Tamaño estimado

Un bloque de trabajo, parecido al de los hooks. Migración chica, un campo en dos
pantallas, y sumar chequeos a `verificar.mjs`. **Lo caro no es el código: es
decidir bien la pregunta 1.**

---

## B · Varios locales

Acá está lo interesante, y por eso conviene leerlo antes de discutir.

**"Varios locales" puede significar dos cosas muy distintas:**

### B1 · El mismo sistema instalado en varios boliches

Cada local con su propio servidor, su propia WiFi, su propia base.

**Esto ya está resuelto y no cuesta nada.** Se copia la carpeta del proyecto a
otra notebook, se corre `migrate up`, y ya hay un sistema independiente. Cada
local tiene su staff, su menú, sus turnos y su arqueo, sin saber nada del otro.

Lo único que falta para que se sienta "suyo" en cada local es la **marca**: el
nombre del boliche y los colores. Hoy el nombre no está puesto en ningún lado
(en `CLAUDE.md` figura literalmente como `[NOMBRE DEL LOCAL]`).

→ Si Alejo quiere vender el sistema a más boliches, **este es el camino**, y la
única tarea real es la personalización de marca.

### B2 · Un sistema central que administra varios locales

Un solo lugar donde el dueño ve las ventas de sus tres boliches, con un menú
compartido y reportes consolidados.

**Esto choca de frente con la restricción central del proyecto.** De `CLAUDE.md`:

> El sistema no puede depender de internet para operar. [...] Si una feature
> necesita internet para funcionar durante la noche, está mal diseñada.

Un sistema central necesita que los locales le hablen a un servidor común. Si
esa conexión es parte del camino operativo, **la noche se cae cuando se cae
internet** — que es exactamente lo que el diseño evita.

**Pero hay una forma que NO rompe nada,** y ya estaba prevista en el diseño
original: cada local sigue operando 100% offline, y **al cerrar el turno**
manda un resumen a un lugar central. El dueño ve sus tres locales al día
siguiente, no en vivo. Eso está anotado desde el principio:

> Sincronización a la nube (si algún día se hace) es al cierre del turno, nunca
> durante.

→ **Ver las ventas de tres locales en vivo, durante la noche, no se puede hacer
sin romper la razón de ser del sistema.** Verlas al día siguiente, sí.

---

## Lo que el Chat tiene que decidir

**Sobre las barras (A):**

1. ¿Se hace? ¿Hay realmente dos barras en el local de tu amigo, o es a futuro?
2. Las 3 preguntas de operación de arriba, sobre todo la primera.

**Sobre los locales (B):**

3. ¿Qué quería decir Alejo con "varios locales"? ¿B1 (vender el sistema a más
   boliches) o B2 (que un dueño vea varios)?
4. Si es B2: ¿alcanza con verlo al día siguiente? Si la respuesta es "lo quiero
   en vivo", hay que rediscutir la restricción central — y eso es una decisión
   de negocio, no técnica.

---

## Recomendación de Claude Code

**Ninguna de las dos ahora.** Antes van dos cosas que ya están anotadas y valen
más:

1. **El Service Worker.** Hoy, si el server se corta y alguien recarga una
   tablet, queda en blanco. Eso rompe una noche; dos barras no arreglan ninguna.
2. **Probar en el local, con las tablets y la WiFi reales.** Todo lo que hay
   está probado en una notebook contra `localhost`. Puede aparecer algo que
   cambie las prioridades.

**Y sobre "personalizable": lo que más mueve la aguja ya está hecho** (el jefe
edita su menú y sus precios solo). Lo segundo sería la marca —el nombre del
local en las pantallas—, que es media hora de trabajo y se nota en cada
pantalla. Las barras y los locales son features para cuando el sistema ya
sobrevivió una noche real.
