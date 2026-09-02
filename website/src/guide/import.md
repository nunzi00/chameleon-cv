---
title: Importar un CV que ya tienes
---

# Importar un CV que ya tienes

Si llegas con un CV en PDF o DOCX, `cv import-cv` lo convierte en un **borrador de fuentes** para que no empieces de
cero. El borrador se escribe en `import/<nombre>/` y **nunca** en `data/sources/`: lo revisas, lo ajustas y **adoptas lo
que quieras** con `cv drafts` (o la pantalla «Borradores») cuando estés conforme.

```bash
cv import-cv cv-antiguo.pdf              # borrador en import/<nombre>/ con su informe
cv build --data import/cv-antiguo        # valida el borrador tal cual, antes de moverlo
```

En la interfaz web (`cv serve`) la misma importación está en **Perfil → Importar CV**.

## Qué hace y qué no

- **Determinista**: reconstruye el orden de lectura desde la maquetación (columnas, tablas con las fechas al margen,
  viñetas partidas), reconoce las secciones por sus títulos en español e inglés y valida cada entrada contra el
  esquema del perfil, **entidad a entidad**: lo que no cumple se degrada con su motivo, no se descarta en silencio.
- **No inventa nada**: lo que no encaja va al `README.md` del borrador, en «Degradado o avisado» (con la línea de
  origen) y «Sin situar (revísalo a mano)».
- **Sin red y sin modelo** salvo que pidas el co-piloto con `--copilot`.

## Una carpeta entera

Si tienes varias versiones de tu CV —y casi todo el mundo las tiene—, `--all` las importa todas y las compara:

```bash
cv import-cv ~/mis-cv --all
```

```text
Fichero                   Borrador                Exp.  Form.  Hab.  Avisos  Sin situar
CV Lucas.pdf              import/cv-lucas           11      7     0      15           4
CV-Lucas-2020.pdf         import/cv-lucas-2020      12      6     0      14          41
Profile.pdf               import/profile             6      3     3       0           0
```

Cada CV va a **su propio borrador, nombrado por el fichero** y no por el perfil: si todos son tuyos, el nombre
del perfil sería el mismo para todos y solo entraría el primero; así, además, se ve de dónde salió cada uno. Un
fichero que falle se anota y **no detiene a los demás**. La tabla es el mapa para decidir cuál merece la pena
revisar: la fila con menos avisos y menos líneas sin situar suele ser la mejor base.

`--all` no se combina con `--copilot` —el co-piloto se pide borrador a borrador, con su coste— ni con `--name`,
que no tendría sentido con varios.

En la web, en **Perfil → Importar CV**, el selector **«Origen»** tiene una tercera opción: «Una carpeta con varios
CV». Escribes la carpeta (relativa al espacio de trabajo) y sale la misma tabla; si algún borrador ya existía, lo
que falló aparece con su motivo y un botón para **reimportar sustituyendo**, que es una segunda acción tuya y
nunca algo automático.

## El informe del borrador

El `README.md` del borrador es el mapa de la revisión. Empieza por sus avisos de calidad, que te dicen si merece la
pena seguir:

| Aviso | Qué significa |
| --- | --- |
| «el texto extraído es muy corto» | el PDF es una imagen sin capa de texto: no hay nada que importar |
| «parece un escaneo con OCR de baja calidad» | el texto llega con residuos (`201&` por `2018`): revisa fechas y centros |
| «parece una plantilla sin rellenar» | el fichero es una plantilla o una guía, no un CV |
| «no se reconoció ninguna entrada con fechas» | puede no ser un CV, o su maquetación no se reconoce |
| «formación con una sola fecha» | la fecha de graduación se tomó como inicio: ajústala si procede |

## Pedir ayuda al co-piloto

Con `--copilot`, las líneas que quedaron **sin situar** se envían al modelo —seudonimizadas, sin nombre ni datos de
contacto— para que **proponga** a qué sección pertenecen:

```bash
cv import-cv cv-antiguo.pdf --copilot
```

Las propuestas aparecen en el `README.md` bajo «Propuestas del co-piloto (no aplicadas)» con su justificación. El
modelo **solo clasifica dentro de un vocabulario cerrado** (experiencia, formación, proyecto, certificación,
habilidad, idioma, logro, resumen, contacto, descartar) y el código verifica cada propuesta antes de mostrarla:
descarta las secciones inventadas, las líneas que no se enviaron y las repetidas. **Nada se escribe en el borrador**:
mueves tú lo que te convenza.

Si eliges un proveedor remoto (`--provider`), verás antes el aviso de coste y tendrás que confirmarlo (`--yes` en
scripts).

### Desde la interfaz web

En **Perfil → Importar CV**, cuando el borrador deja líneas sin situar aparece el botón **«Refinar con el co-piloto»**
con un selector de proveedor. El refinado es un trabajo del co-piloto como los demás: puedes seguir su progreso, un
proveedor remoto pide antes confirmar el coste y las propuestas verificadas se añaden al `README.md` del borrador —que
la página recarga— sin aplicarse. Funciona con cualquier borrador de `import/`, no solo con el que acabas de subir.

### Mover una propuesta al borrador

Cada propuesta trae un botón **«Mover al borrador»**. El co-piloto sigue sin escribir nada: mueve el botón, y solo la
línea que le señalas. Antes de tocar el borrador se abre una confirmación con la línea a la vista y, cuando la sección
lo exige, los campos que el esquema pide y la línea no puede dar:

| Sección propuesta | Lo que se te pide |
| --- | --- |
| habilidad, logro, resumen, proyecto, certificación, descartar | nada: la línea basta |
| idioma | el nivel MCER, ya relleno si la línea lo declara («Inglés — C1») |
| contacto | a qué campo va: correo, teléfono, ubicación o enlace |
| experiencia | empresa, puesto y fecha de inicio (el fin, en blanco, significa «en curso») |
| formación | institución y titulación; las fechas son opcionales |

Al confirmar, la línea se escribe en el fichero que le corresponde (`skills.csv`, `experience/<entrada>.md`…), sale de
«Sin situar» y queda registrada en el `README.md` bajo **«Aplicado»** con su destino. Ese registro es lo que te permite
deshacerlo a mano. Si algo no cumpliera el esquema no se escribe nada y el diálogo te dice qué falta: el borrador que
sale de aplicar una propuesta sigue validando con `cv build --data`.

## Desde LinkedIn

Si tu CV vive en LinkedIn, la vía es su **exportación oficial de datos**, no la URL del perfil: esa URL devuelve
el muro de acceso, y el `robots.txt` de LinkedIn prohíbe el acceso automatizado. La exportación, además, da mejor
resultado, porque entrega los datos **estructurados** en CSV y aquí no hay maquetación que adivinar.

### Cómo pedir la exportación

1. Entra en LinkedIn desde el navegador (esto no se puede hacer desde la app móvil).
2. Pulsa tu foto arriba a la derecha → **Configuración y privacidad** (*Settings & Privacy*).
3. En la columna de la izquierda, **Privacidad de datos** (*Data privacy*).
4. Abre **Obtener una copia de tus datos** (*Get a copy of your data*).
5. Elige la **segunda** opción, «Selecciona los datos que quieres», y marca al menos: **Positions**,
   **Education**, **Skills**, **Languages**, **Certifications**, **Projects**, **Profile**, **Email Addresses**
   y **Phone Numbers**. La primera opción («archivo más grande») también vale, pero tarda más y trae decenas de
   ficheros de mensajes y conexiones que no son un CV.
6. **Solicitar archivo** y confirma con tu contraseña.
7. LinkedIn te avisa por correo: la selección concreta suele estar lista en **unos diez minutos**; el archivo
   completo puede tardar **hasta 24 horas**. Descarga el zip desde ese correo o desde la misma pantalla.

::: tip Comprueba qué traes antes de importar
`unzip -l ~/Downloads/Basic_LinkedInDataExport.zip` te lista los CSV. Si no ves `Positions.csv`, vuelve al
paso 5: la selección se quedó corta.
:::

Después, pásaselo a `cv` sin más:

```bash
cv import-linkedin ~/Downloads/Basic_LinkedInDataExport.zip
```

Los nombres de los ficheros dentro del zip varían con el idioma de la interfaz y con la versión, así que `cv`
los busca por su nombre base y **no le importa que vengan dentro de una carpeta**.

### Desde la interfaz web

En **Perfil → Importar CV**, el selector **«Origen»** cambia entre un CV maquetado y la exportación de LinkedIn.
Eligiendo la segunda, el campo pasa a aceptar el `.zip` y la página te recuerda dónde pedirlo. El borrador sale
en el mismo sitio y con el mismo informe; la diferencia se ve al leerlo: **no hay líneas «sin situar»**.

Se lee `Profile.csv` (nombre, titular, resumen, ubicación, enlaces), `Positions.csv` (experiencia; sin fecha de
fin, el puesto queda «en curso»), `Education.csv`, `Certifications.csv`, `Projects.csv`, `Skills.csv`,
`Languages.csv` —con los cinco niveles de LinkedIn traducidos a MCER— y tus correo y teléfono. Lo que no esté en
el zip, simplemente no aparece.

El borrador sale en `import/<nombre>/` igual que el de un PDF, con el mismo informe y la misma validación, así
que a partir de aquí el camino es el de abajo. La diferencia se nota en el informe: al venir de datos
estructurados, **no hay líneas «sin situar»**.

### El PDF que exporta LinkedIn

Si en vez de la exportación de datos usas el **«Guardar como PDF»** del propio perfil, `cv` lo reconoce por su
URL y su pie de página, y aplica las reglas de ese formato: la empresa va arriba y el puesto debajo, la formación
viene sin fechas —y no se le inventa ninguna—, y el nombre se comprueba contra el *slug* de tu URL. Sale un
borrador limpio, pero **la exportación de datos sigue siendo mejor**: son datos estructurados en vez de una
maquetación que hay que adivinar.

## Revisar los borradores y adoptarlos

Importar deja un **borrador**, no toca tu perfil. Para verlos todos y llevarte lo que te interese está
`cv drafts`, y en la web la pantalla **Perfil → Borradores**:

```bash
cv drafts                                      # todos los borradores, con lo que reconoció cada uno
cv drafts show cv-antiguo                      # sus entradas, con el id de cada una
cv drafts duplicates                           # lo que se repite entre borradores y contra tus fuentes
cv drafts adopt cv-antiguo --entry exp-acme    # copia esa entrada a data/sources/
cv build                                       # y recompila cuando la hayas revisado
```

**Adoptar añade, no sustituye.** Cada entrada se escribe como un **fichero nuevo** con un id libre, y no se toca
ni una fuente tuya: si te equivocas, borras el fichero y ya está. Antes de escribir nada se valida el perfil
entero que quedará, así que no puedes dejar unas fuentes que `cv build` rechace. `--dry-run` te enseña el plan.

**No es un *merge***: no se mezclan dos versiones del mismo empleo. Adoptas la que prefieras y la editas después.

### Qué está repetido

Si has importado varias versiones de tu CV, el mismo empleo aparece en todas —y casi nunca igual: cambian las
fechas, a veces la empresa y el puesto salen intercambiados, y un PDF maquetado letra a letra llega como
`B A S E R  L U G O`—. `cv drafts duplicates` **agrupa y pregunta**: te enseña cada grupo con todos sus miembros,
de qué borrador viene cada uno y **cuál ya tienes en tus fuentes**, para que no lo dupliques. No elige por ti,
porque cuando los CV se contradicen no hay forma honesta de saber cuál lleva razón: eso lo sabes tú.

### Corregir antes de adoptar

Los ficheros del borrador se editan como una fuente cualquiera, desde la pantalla **Borradores** o con tu editor.
Es lo que hace falta cuando el informe dice «experiencia sin empresa reconocida: lleva "Empresa pendiente"».
Corregir un borrador **no toca** `data/sources/`.

## Después de importar

1. Lee el `README.md` y corrige lo señalado (en la web, **Perfil → Borradores**).
2. Valida: `cv build --data import/<nombre>`.
3. Adopta lo que quieras con `cv drafts adopt` —o el botón «Adoptar en mis fuentes»— y sigue con
   [Generar el CV](/guide/generate).
