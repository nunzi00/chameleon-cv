# Varias personas en un mismo espacio de trabajo (T-9.32)

| | |
|---|---|
| **Estado** | Vigente. Implementada en la v1.26.0. |
| **Encargo** | Del PO, 2026-09-04: «quiero que la misma aplicación pueda tener usuarios, por ejemplo en chameleon-cv-lucas quiero tener el usuario lucas, el usuario invitado1…». |
| **Relación** | `docs/arquitectura.md` §2 (ecosistema de datos), `docs/api-headless.md` §5 y §6 (contrato y modelo de amenazas), `docs/ui-layouts.md` (la cabecera). |

## 1. La idea, en una frase

**Un usuario es un espacio de trabajo dentro del espacio de trabajo.**

```
chamaleon-cv-lucas/
  cv.toml                      ← COMPARTIDO: valores por defecto de todos
  themes/                      ← COMPARTIDO: los temas de CV instalados
  usuarios/
    lucas/                     ← un espacio de trabajo completo
      data/sources/  data/dist/  output/  import/  offers/  revisiones/  cv.toml
    invitado1/
      data/sources/  …
```

Toda la lógica del producto resuelve sus rutas contra `context.cwd`: fuentes, artefacto, salidas, historial
(`output/historial-fuentes/`), borradores, ofertas y revisiones. Por eso **cambiar de usuario es cambiar esa
raíz, y nada más**: no hay una segunda implementación de nada, ni un `if (usuario)` repartido por el código.
`cv serve --workspace` ya demostraba que la raíz era un parámetro; esto la nombra.

Es también el motivo de que la funcionalidad quepa en tan poco: un módulo de casos de uso
(`src/app/users.ts`), un enganche en la CLI, **un** punto en el servidor y un selector en la cabecera.

## 2. Un usuario NO es una cuenta

Decidido con el director el 2026-09-04, y hay que decirlo en todas partes porque la palabra «usuario» invita a
suponer lo contrario:

> Un usuario es una frontera de **organización**, no de **seguridad**. No hay contraseñas. Quien tiene la URL y
> el token de `cv serve` puede abrir cualquiera de los usuarios, y quien tiene una terminal puede leerlos con
> `cat`.

El modelo de amenazas del producto (`docs/api-headless.md` §6) es «un servidor en tu propia máquina, en
loopback, con un token de sesión». Poner contraseñas encima de unos ficheros que el mismo usuario del sistema
operativo lee sin pedir permiso daría una sensación de aislamiento **falsa**, que es peor que no dar ninguna.
Si de verdad hacen falta fronteras, la del sistema operativo ya existe: dos cuentas, dos directorios, dos
`cv serve`.

Lo que sí resuelve: que el CV de una persona no se mezcle con el de otra, que cada una tenga su historial y sus
revisiones, y que prestar la herramienta no signifique enseñar tu vida laboral.

## 3. Elegir usuario

| Cliente | Cómo |
|---|---|
| CLI | `cv --user <id> <orden>` (antes de la orden) o `export CHAMELEON_USER=<id>` |
| API | Cabecera `x-cv-user: <id>` en cada petición |
| Web | El selector de la cabecera; se recuerda en el navegador (`cv.user`) |
| Quiosco | `cv serve --user <id>`: el servidor queda **fijado** y la web pierde el selector |

**Cambiar de usuario en la web recarga la página.** Cada pantalla pide lo suyo al montarse, así que refrescar
solo el contexto dejaría la cabecera diciendo una cosa y el contenido —el fichero abierto en Fuentes, la
revisión a medias, la lista de salidas— enseñando la de la persona anterior. Se conserva la pantalla, no el
fichero: ese identificador es de otro perfil. La recarga se inyecta como una propiedad (`reload`), como el
`fetch`, para que se pueda comprobar sin recargar de verdad.

**No hay un «usuario activo» guardado en el disco del espacio de trabajo.** Es deliberado: un estado invisible
que decide de quién es el CV que acabas de generar es la clase de cosa que se descubre tarde y mal. En la CLI
el usuario es explícito siempre; en la web se recuerda porque la cabecera lo enseña en todo momento, que es lo
que convierte un estado oculto en uno visible.

### Sin elegir a nadie

- Si la raíz tiene `data/sources/`, se trabaja sobre la raíz —es un espacio de trabajo válido y siempre lo
  fue—, pero **se avisa** por stderr de que hay usuarios y de que no se ha elegido ninguno. Trabajar sobre la
  raíz está permitido; hacerlo sin enterarte, no.
- Si la raíz **no** tiene fuentes y sí hay usuarios, la orden se para y enumera los usuarios. Es el caso normal
  después de `--adopt`, y un «no hay fuentes» a secas no explicaría nada.

## 4. Qué es de cada uno y qué se comparte

| | Dónde | Por qué |
|---|---|---|
| Fuentes, artefacto, salidas, historial, borradores, ofertas, revisiones | **Por usuario** | Son la persona |
| `themes/` | **Compartido** (la raíz) | Un tema es del espacio de trabajo; instalarlo N veces no beneficia a nadie |
| `cv.toml` | **Los dos**: la raíz pone los valores por defecto y el del usuario los anula **clave a clave** | Que un usuario cambie su tema no puede dejarlo sin proveedor de modelos |
| Claves de API de proveedores remotos | **Compartidas** (`~/.config/chameleon-cv/keys.json`) | Están fuera del espacio de trabajo, son del usuario del sistema operativo |
| Caché de respuestas del modelo | **Compartida** (caché del usuario del sistema) | Se indexa por hash del prompt exacto: para «leer» lo de otro habría que tener ya su prompt |

`[llm]` y `[serve]` se **escriben** siempre en el `cv.toml` de la raíz, también desde la pantalla Ajustes:
configuran el proveedor de modelos y el servidor, que son de la máquina y no de una persona. El `cv.toml` de un
usuario existe para anular su `[theme]` y se edita a mano.

### Discrepancias con el director, y por qué

El director decidió (2026-09-04) que el `cv.toml` del usuario **anulara entero** al de la raíz, y que las
claves de API y la caché se **duplicaran** por usuario. Se ha hecho lo contrario en los tres, con razones:

1. **`cv.toml` clave a clave, no entero.** Es la regla que el producto ya usaba para `[theme]` sobre el
   `theme.toml` del tema (`docs/arquitectura.md`, T-5.2): cascada, no sustitución. Anular entero convertiría
   «quiero otro tema» en «me he quedado sin proveedor de modelos» sin que nada lo dijera. El propio director,
   en la consulta anterior del mismo día, había dicho «hereda de la raíz»; entre sus dos respuestas se ha
   elegido la que coincide con el precedente del producto.
2. **Claves de API, compartidas.** Viven fuera del espacio de trabajo, en la configuración del usuario del
   sistema operativo, y no son un concepto del espacio de trabajo. Duplicarlas por «usuario» insinuaría un
   aislamiento que acabamos de decidir que no existe: cualquiera con el token cambia de usuario y las usa.
3. **Caché, compartida.** Se indexa por el hash del prompt exacto y vive en la caché del usuario del sistema.
   Para obtener la respuesta cacheada de otro habría que construir su prompt idéntico, y para eso hay que tener
   ya su contenido. Separarla costaría aciertos de caché a cambio de una protección que no protege de nada.

## 5. Convertir un espacio existente en el primer usuario

Nada se migra solo. Cuando se quiere, hay una orden:

```bash
cv users create lucas --adopt
```

**Traslada** a `usuarios/lucas/` los directorios que son de una persona (`data`, `output`, `import`, `offers`,
`revisiones`, `revisiones-archivadas`) con un renombrado por directorio: ni un byte se reescribe. `cv.toml` y
`themes/` se quedan en la raíz, porque son del espacio de trabajo.

## 6. Retirar un usuario

`cv users remove <id>` **no borra**: renombra su espacio entero a `usuarios/<id>.<marca>.bak`, el mismo
procedimiento que `cv import --replace` (C9: nada se destruye, se aparta). Deshacerlo es volver a renombrarlo.

## 7. El identificador

`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`: minúsculas, dígitos y guiones, de 1 a 40, sin empezar ni terminar en
guión. Es a la vez un nombre de directorio y un valor de cabecera HTTP; que no admita punto ni barra es lo que
hace **imposible** que un identificador manipulado salga de `usuarios/`. Un identificador que no cumple la
regla es un 400, la misma clase de error que una ruta de fichero que no se acepta.

## 8. La API

| Ruta | Qué hace |
|---|---|
| `GET /users` | Los usuarios, quién es el de esta petición, si el servidor está fijado y si la raíz sirve por sí sola |
| `POST /users` | Crea `usuarios/<id>/` (`empty` para no sembrar, `adopt` para traer lo de la raíz) |
| `DELETE /users/{id}` | Lo retira apartándolo; devuelve la ruta de la copia |

Estas tres son las **únicas** que trabajan siempre sobre la raíz: gestionan los espacios, no el contenido de
ninguno. Todas las demás reciben la raíz que les toca porque el servidor resuelve la cabecera `x-cv-user`
**una vez por petición**, antes de llamar al manejador (`scopedState` en `src/serve/routes.ts`). Ninguna ruta
sabe que los usuarios existen, y esa es la propiedad que hay que conservar.

Con `cv serve --user <id>`, pedir otro usuario por la cabecera es un **409**, no un cambio.

## 9. `.gitignore`

`cv init` escribe cuatro entradas: `data/dist/`, `output/`, `usuarios/*/data/dist/` y `usuarios/*/output/`. A
un `.gitignore` que ya existía solo se le **exigen** las dos primeras —avisar de las de usuarios a quien no
tiene ninguno sería ruido—; quien crea el primero con `--adopt` recibe el recordatorio entonces.
