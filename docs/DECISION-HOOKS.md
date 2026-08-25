# DECISIÓN PENDIENTE — `[HOOKS]`

> **Para qué es este archivo:** subilo al Proyecto en Claude Chat y decidí ahí.
> Claude Code lo escribió mirando el código y el servidor reales, pero **no
> tocó nada**: la elección de arquitectura es del Chat.
>
> Escrito el 25 ago 2026, con el schema del Bloque 1 aplicado.

---

## El problema en un párrafo

El schema ya cubre **quién puede ver y tocar qué** (eso lo probamos: 52 de 52
chequeos verdes). Lo que **no** cubre es **qué es una operación válida**. Hoy
las reglas de "cómo se cobra bien" viven en las pantallas que todavía no
escribimos. Eso significa que cualquiera con la Admin UI abierta, o alguien que
sepa mandar un pedido a mano por la red, puede saltarse todas.

No es teórico. Lo probé contra el servidor prendido.

---

## Evidencia: 9 agujeros abiertos hoy

Cada fila es una operación que el negocio **no debería permitir** y que la API
hoy acepta con un `200 OK`.

| # | Lo que se puede hacer hoy | Lo que cuesta en el local | Rompe |
|---|---|---|---|
| 1 | Crear una orden en un turno **ya cerrado** | Esa venta no entra en el arqueo de ningún turno. Plata que desaparece del recuento | — |
| 2 | Cobrar **sin copiar** `precio_unit` ni `nombre_snapshot` | La orden vieja se renderiza con el precio actual. Subís el Fernet a las 3am y el arqueo no cierra nunca | **NO ROMPER #1** |
| 3 | Poner `total = $1` en una orden con $16.000 de tragos | La caja declara uno y cobra otro. Fuga directa | **NO ROMPER #1** |
| 4 | Saltar de `pendiente` a `entregado` sin pasar por `preparando` ni `listo` | Un trago figura entregado sin haberse preparado, y sin registro de quién | Máquina de estados |
| 5 | Cambiar `precio_unit` de una orden **ya cobrada** | Se maquilla el arqueo después del hecho | **NO ROMPER #1** |
| 6 | Pisar el `barman_id` de un trago que ya tomó otro | Dos barmans preparan el mismo trago. Y la métrica de productividad miente | Regla dura #2 |
| 7 | Anular un trago cobrado **sin motivo y sin evento** | Es *el* agujero de control interno. Si el barman no toca plata, anular es lo único que le queda | **Regla dura #5** |
| 8 | Marcar la orden `entregada` con su único item en `anulado` | El estado de la orden miente sobre sus items | **NO ROMPER #4** |
| 9 | Abrir un segundo turno con otro ya abierto | Las órdenes se reparten entre dos turnos y ningún arqueo cierra | — |

*(Una décima prueba —repetir el número 501 en **otro** turno— también pasa, pero
esa **tiene** que pasar: el número resetea por turno. Sirvió de control de que
la prueba no daba verde por error.)*

**Lo que el schema SÍ ya cubre y no hay que volver a tocar:**
el portón `borrador → cobrada`, el append-only de `eventos`, los permisos por
rol, y el número único dentro del mismo turno.

---

## Las tres opciones

### A · El servidor hace la operación completa

El servidor expone operaciones de negocio en vez de dejar que la pantalla
escriba campo por campo:

```
POST /api/tragos/cobrar    { orden_id, metodo_pago }
POST /api/tragos/claim     { item_id }
POST /api/tragos/listo     { item_id }
POST /api/tragos/entregar  { item_id }
POST /api/tragos/anular    { item_id, motivo }
```

`cobrar` hace **todo junto y de una sola vez**: valida que haya turno abierto,
copia precio y nombre desde `productos`, suma el total él mismo, saca el
siguiente número del turno, sella `cobrada_at` y escribe el evento. Si algo
falla en el medio, no queda nada a medias: se deshace entero.

- ✅ Cierra los 9 agujeros
- ✅ La caja hace **una** llamada. Si la tablet se muere en el medio, la orden
  queda intacta en `borrador`, no a medio cobrar
- ✅ Resuelve la carrera de los dos cajeros pidiendo el mismo número al mismo
  tiempo, porque la asignación pasa dentro de la operación
- ✅ El `motivo` de anulación es obligatorio por diseño: sin él no hay llamada
- ✅ Las pantallas quedan tan simples que las puede escribir Sonnet
- ❌ Más código de servidor antes de ver la primera pantalla

### B · Guardas que rechazan lo inválido

El servidor no hace el trabajo, solo lo juzga: cuando la pantalla intenta
escribir algo, un hook lo revisa y lo rechaza si está mal.

- ✅ Cambio más chico, se puede hacer de a poco
- ✅ Las pantallas siguen hablándole a PocketBase de la forma normal
- ✅ Cierra bien los agujeros 1, 4, 5, 6, 9 y —con un poco de trabajo— el 3
- ❌ **No da atomicidad.** Cobrar sigue siendo varios pedidos separados: si la
  tablet se apaga entre el tercero y el cuarto, la orden queda a medio congelar
  y nadie se entera hasta el arqueo
- ❌ El agujero 7 (anular sin evento) queda difícil: el evento se escribe en
  *otra* tabla, y una guarda no puede exigir algo que todavía no pasó
- ❌ La carrera del número sigue: dos cajeros leen "el que sigue es el 5" al
  mismo tiempo. El índice único evita el duplicado, pero uno de los dos cobros
  falla y hay que reintentar en la pantalla

### C · Híbrido — `cobrar` por operación, el resto por guardas

`cobrar` y `anular` (las dos que tocan plata y control interno) van como
operación del servidor, estilo A. El resto de las transiciones —claim, listo,
entregado— van como guardas, estilo B, porque son de un solo campo y no
necesitan atomicidad.

- ✅ Cierra los 9 agujeros
- ✅ Menos código que A: solo dos operaciones nuevas, no cinco
- ✅ El realtime de PocketBase sigue funcionando igual para la barra, que es lo
  que hace que las pantallas se actualicen solas
- ❌ Dos estilos conviviendo. Hay que dejar escrito cuál se usa para qué, o en
  seis meses no se entiende

---

## Lo que NO cambia en ninguna de las tres

- **El schema queda igual.** Ninguna opción pide una migración nueva.
- **Los 52 chequeos actuales siguen valiendo.** Son la red de seguridad: si
  algún hook rompe un permiso, el script lo canta.
- **Se escribe en JavaScript, dentro de `pb/pb_hooks/`.** Es lo único que
  mantiene la promesa de "un solo ejecutable": PocketBase corre esos archivos
  adentro suyo, sin compilar nada. Hacerlo en Go obligaría a compilar un binario
  propio para la Raspberry Pi del local, y ahí se termina el "bajás el .exe y
  anda".

---

## Lo que el Chat tiene que decidir

**Técnicas:**

1. ¿A, B o C?
2. El timeout del claim `[CLAIM-TIMEOUT]`, ¿corre solo en el servidor (un reloj
   interno cada minuto), o lo dispara la pantalla de la barra? Si lo dispara la
   pantalla, un trago abandonado en una tablet apagada no vuelve nunca.
3. La derivación del estado de la orden a partir de sus items, ¿la calcula el
   servidor cada vez que cambia un item, o se calcula al vuelo cuando alguien
   mira la pantalla?

**De operación — estas solo las podés contestar vos:**

4. Si el servidor rechaza un cobro a las 2am con cola de gente, ¿la caja
   reintenta sola o pasás directo al talonario de papel? Define qué tan
   estricto conviene ser.
5. Anular un trago **ya cobrado**, ¿lo puede hacer el barman poniendo un motivo,
   o hace falta el PIN del jefe? El modelo hoy solo pide motivo.
6. ¿Existe algún caso legítimo de vender con el turno cerrado? (Ej: el último
   pedido mientras se cierra la caja.) Si no existe, se prohíbe y listo.

---

## Recomendación de Claude Code

**Opción C**, y hacerla **antes** que las pantallas.

Dos razones concretas:

1. **Los agujeros que más duelen son los que no se ven.** El 2, el 3, el 5 y el
   7 no rompen nada en pantalla: rompen el arqueo a las 6 de la mañana, o el
   control sobre las anulaciones. Ese es exactamente el tipo de error que
   conviene que sea imposible, no que dependa de que la pantalla esté bien
   escrita.
2. **Hacerlo primero abarata todo lo que viene después.** Si el servidor ya
   congela precios y rechaza transiciones inválidas solo, las pantallas pasan a
   ser "mostrar y mandar". Eso es trabajo de Sonnet 5, y te estira los límites
   semanales. Si las pantallas van primero, esa lógica se enquista adentro y
   mudarla después duele el triple.

**Si el Chat elige C, el bloque siguiente sería:** `cobrar` y `anular` como
operaciones del servidor, guardas para claim/listo/entregado, y sumar al script
de verificación las 9 pruebas de arriba dadas vuelta — que hoy pasan y tienen
que pasar a fallar. Ese script ya está escrito y probado; se agrega al repo
cuando haya decisión.
