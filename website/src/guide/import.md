---
title: Importar un CV que ya tienes
---

# Importar un CV que ya tienes

Si llegas con un CV en PDF o DOCX, `cv import-cv` lo convierte en un **borrador de fuentes** para que no empieces de
cero. El borrador se escribe en `import/<nombre>/` y **nunca** en `data/sources/`: lo revisas, lo ajustas y lo mueves
tú cuando estés conforme.

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

## Después de importar

1. Lee el `README.md` y corrige lo señalado.
2. Valida: `cv build --data import/<nombre>`.
3. Mueve las fuentes a `data/sources/` cuando estén a tu gusto y sigue con [Generar el CV](/guide/generate).
