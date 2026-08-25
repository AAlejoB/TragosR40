# pb/ — PocketBase

El ejecutable **no está en el repo** (33 MB). Cada máquina baja el suyo.

Versión en uso: **v0.40.1**

## Instalar

Bajá el binario de tu SO desde
<https://github.com/pocketbase/pocketbase/releases/tag/v0.40.1>
y dejá el ejecutable en esta carpeta (`pb/pocketbase` o `pb/pocketbase.exe`).

```bash
# Linux / Raspberry Pi (el server del local)
curl -L -o pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.40.1/pocketbase_0.40.1_linux_arm64.zip
unzip pb.zip pocketbase && rm pb.zip && chmod +x pocketbase
```

```powershell
# Windows (desarrollo)
curl -L -o pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.40.1/pocketbase_0.40.1_windows_amd64.zip
tar -xf pb.zip pocketbase.exe; Remove-Item pb.zip
```

## Primer arranque en una máquina limpia

```bash
./pocketbase migrate up
./pocketbase superuser upsert admin@ruta40.local CAMBIAR_ESTA_CLAVE
./pocketbase serve --http=0.0.0.0:8090
```

`migrate up` crea las 6 colecciones y carga el seed (3 staff + 12 productos).
`serve` también corre las migraciones pendientes al arrancar.

- REST API → <http://127.0.0.1:8090/api/>
- Admin UI → <http://127.0.0.1:8090/_/>

`--http=0.0.0.0:8090` es lo que hace que las tablets de la LAN lo vean.
Con `127.0.0.1` solo entra la máquina local.

## Verificar el schema

```bash
node verificar.mjs
```

92 chequeos end-to-end contra la API real: colecciones, seed, login por PIN, el
portón `borrador → cobrada`, congelamiento de `precio_unit`, append-only de
`eventos`, permisos por rol, los 9 agujeros cerrados por los hooks y las dos
carreras (cobrar dos veces, dos barmans sobre el mismo trago).

La última prueba espera hasta 70s para ver al cron devolver un trago abandonado.
Para saltearla: `node verificar.mjs --rapido`.

## Los hooks

Las reglas de negocio viven en `pb_hooks/`. Ojo con esto:

- **`main.pb.js`** — endpoints, guardas, derivación y cron. El sufijo `.pb.js`
  es obligatorio: un `.js` común **no se carga y el server no avisa**.
- **`utils.js`** — helpers. NO termina en `.pb.js` a propósito: es un módulo que
  los handlers traen con `require()`, no un hook.

Los hooks sólo se recargan al reiniciar el server (`--hooksWatch` no tiene
efecto en Windows). Si tocaste algo y no ves el cambio, cerrá la ventana de
`arrancar.cmd` y volvé a abrirla.

Al arrancar, el log tiene que decir:

```
[hooks] Sistema de Tragos cargado OK
```

Si esa línea no aparece, los hooks no se cargaron y el sistema queda sin
ninguna de sus reglas. Ver `docs/HISTORIA.md` § Gotchas de los hooks.

## Reset total (borra TODOS los datos)

```bash
rm -rf pb_data
./pocketbase migrate up
```

## Credenciales de desarrollo

⚠️ **Cambiar antes de la primera noche real.**

| Quién | usuario | PIN |
|---|---|---|
| Cajero | `caja1` | `1111` |
| Barman | `barra1` | `2222` |
| Jefe | `jefe` | `9999` |

Superuser (admin UI): `admin@ruta40.local` / `ruta40admin`
