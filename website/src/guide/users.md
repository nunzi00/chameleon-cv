---
title: Varias personas, un espacio de trabajo
---
# Varias personas, un espacio de trabajo

Un espacio de trabajo puede contener **usuarios**: tú y quien quieras, cada uno con sus fuentes, sus CV
generados y su historial, sin mezclarse.

```
chamaleon-cv-lucas/
  cv.toml          ← compartido
  themes/          ← compartido
  usuarios/
    lucas/         ← data/sources, output, import, offers, revisiones…
    invitado1/
```

La idea cabe en una frase: **un usuario es un espacio de trabajo dentro del espacio de trabajo**. Todo lo que
sabes hacer con Chameleon CV funciona igual dentro de uno; lo único que cambia es la raíz.

## Un usuario no es una cuenta

::: warning No hay contraseñas, y es a propósito
Un usuario **separa el trabajo, no lo protege**. Quien tenga la URL y el token de `cv serve` puede abrir
cualquiera de los usuarios, y quien tenga una terminal puede leer sus ficheros directamente.

Chameleon CV es un programa que corre en tu máquina, en `127.0.0.1`. Poner contraseñas sobre unos ficheros que
tu propio sistema operativo deja leer sin pedir permiso daría una sensación de seguridad falsa, que es peor que
no dar ninguna. Si necesitas aislamiento de verdad, úsalo donde existe: dos cuentas del sistema, dos
directorios, dos `cv serve`.
:::

Para lo que sí sirve: prestarle la herramienta a alguien sin enseñarle tu vida laboral, y que su CV no acabe
mezclado con el tuyo.

## Crear el primero

```bash
cv users create invitado1
```

Nace con el mismo dataset de ejemplo que `cv init`, así que compila desde el primer momento. Con `--empty`
nace vacío.

Desde la web es el botón **Usuario** de la cabecera, que está siempre, también cuando todavía no hay ninguno.

## Trabajar como alguien

```bash
cv --user invitado1 build
cv --user invitado1 generate-cv -s backend

export CHAMELEON_USER=invitado1   # o fíjalo para toda la sesión
```

La bandera va **antes** de la orden. En la web, el selector de la cabecera; la elección se recuerda en ese
navegador y la cabecera enseña en todo momento con quién estás trabajando.

**Cambiar de usuario recarga la página.** Todo lo que hay en pantalla —el fichero abierto en Fuentes, la
revisión a medias, la lista de salidas— es de la persona anterior, así que refrescar solo la cabecera dejaría
el contexto diciendo una cosa y el contenido enseñando otra. Se conserva la **pantalla** en la que estabas,
no el fichero: ese identificador es de otro perfil y no tiene por qué existir en este.

::: tip No hay un «usuario activo» guardado en el disco
En la terminal el usuario es explícito siempre. Un estado invisible que decidiera de quién es el CV que acabas
de generar sería la clase de cosa que se descubre tarde y mal.
:::

## Si no eliges a nadie

- Si la raíz todavía tiene sus propias fuentes, se trabaja sobre ella —siempre fue un espacio de trabajo
  válido—, pero se te avisa de que hay usuarios y no has elegido ninguno.
- Si la raíz ya no tiene fuentes, la orden se para y te enumera los usuarios.

## Convertir lo que ya tienes en el primer usuario

Si llevas meses con tu CV en la raíz y ahora quieres añadir a alguien:

```bash
cv users create lucas --adopt
```

**Traslada** a `usuarios/lucas/` lo que es tuyo (`data`, `output`, `import`, `offers`, `revisiones`) con un
renombrado por directorio: ni un byte se reescribe, y nada se borra. `cv.toml` y `themes/` se quedan en la
raíz, porque son del espacio de trabajo y los comparte todo el mundo.

## Qué se comparte

| | |
|---|---|
| Fuentes, artefacto, salidas, historial, borradores, ofertas, revisiones | de cada usuario |
| `themes/` (los temas de CV instalados) | compartidos |
| `cv.toml` | la raíz pone los valores por defecto; el del usuario los anula **clave a clave** |
| Claves de proveedores remotos y caché del co-piloto | compartidas (viven fuera del espacio de trabajo) |

Un `usuarios/<id>/cv.toml` con solo esto le cambia el tema a esa persona sin tocarle nada más:

```toml
[theme]
name = "cinta"
```

Los ajustes del co-piloto y del servidor (`[llm]`, `[serve]`) se escriben siempre en el `cv.toml` de la raíz,
también desde la pantalla **Ajustes**: configuran el proveedor de modelos y el servidor, que son de la máquina.

## Un invitado que trae su CV

El camino entero, sin salir de la web:

1. **Usuario → Crear** en la cabecera: nace con el perfil de ejemplo, para que la aplicación funcione desde el
   primer momento.
2. **Importar CV**: su PDF o DOCX cae en *su* `import/`, nunca en el de nadie más.
3. **Borradores → «Usar este borrador como mis fuentes»**: el borrador **entero** pasa a ser su perfil, también
   su nombre, su titular, su contacto y sus habilidades, que marcando entradas una a una no se pueden traer.
4. **Estado → Compilar** y ya puede generar su CV.

El paso 3 sustituye, así que enseña el plan antes y **no borra nada**: el perfil de ejemplo con el que nació
queda entero en `data/sources.<marca>.bak`.

## Prestar la web a alguien: el modo quiosco

```bash
cv serve --user invitado1
```

El servidor queda **fijado** a ese usuario: la web pierde el selector y no hay forma de llegar a los demás. Es
lo que quieres cuando le dejas el portátil a otra persona un rato.

## Retirar un usuario

```bash
cv users remove invitado1
```

**No borra.** Renombra su espacio entero a `usuarios/invitado1.<marca>.bak`, igual que hace `cv import
--replace`. Para deshacerlo, vuelve a renombrarlo.

## Ver quién hay

```bash
cv users            # id, nombre compilado, si tiene fuentes y su ruta
cv users path lucas
```

## El `.gitignore`

`cv init` ya excluye `usuarios/*/data/dist/` y `usuarios/*/output/`: los CV generados y el artefacto contienen
datos personales en claro y no se versionan nunca. Si tu espacio es anterior, añádelos a mano.
