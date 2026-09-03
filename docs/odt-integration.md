# Generar el CV en un formato abierto y editable (ODT, T-9.23)

## §0 Encargo

**Del PO (2026-09-02)**: «añade la opción de generar cv en formato abierto como odt por ejemplo para poder
editarlo manualmente».

El producto tenía dos salidas y ninguna servía para eso: el **PDF** es para entregar, no para editar, y el
**Markdown** se edita bien pero no es lo que pide una empresa cuando dice «mándanos el CV en un documento».

## §1 Por qué ODT y no DOCX

**ODT** (OpenDocument Text) es un estándar ISO/IEC 26300, el formato nativo de LibreOffice, y lo abren también
Word y Google Docs. Su paquete es un zip con XML dentro, así que se escribe **sin dependencias**: `zlib` para el
CRC y el deflate, y las cabeceras a mano —lo mismo que ya hace el lector de `src/themes/archive.ts`—.

DOCX (OOXML) haría falta si el destinatario exigiera Word, pero es un formato bastante más grande de implementar
a mano y no aporta nada que ODT no dé para el caso de uso: **seguir editando**. Queda registrado en §5 por si el
PO lo pide.

## §2 El envase: un zip determinista

`src/renderers/odt/zip.ts`. Lo que hace falta y nada más, con dos exigencias que no son caprichos:

- **Determinista**: fecha fija (1980-01-01) en todas las entradas, así que el mismo perfil da el mismo documento.
  Con un matiz que **destapó CI**: los bytes *comprimidos* dependen de la implementación de zlib —la de Arch y la
  del Node oficial no comprimen igual, y el golden salía 32 bytes más corto—, exactamente el mismo problema que
  ya tenían los PDF. La cura es la misma: el arnés compara los ODT en **forma canónica**, por sus entradas ya
  descomprimidas. Lo que importa del documento es su contenido, no cuánto ocupó al comprimirlo.
- **`mimetype` primero y SIN comprimir**: un paquete ODF se reconoce leyendo los primeros bytes del zip
  (OpenDocument v1.3 §3.3). Comprimido, LibreOffice lo abre igual, pero `file(1)` y media herramienta del mundo
  lo ven como un zip cualquiera. Con la entrada en su sitio, `file` responde `OpenDocument Text`.

## §3 El documento

`src/renderers/odt/document.ts` parte del mismo **`StructuredView`** que consumen la plantilla de Typst y el
maquetador de pdfkit, así que el CV es exactamente el mismo: cambia el envase, no el contenido ni la selección.

El objetivo **no es la tipografía, es que puedas editarlo**, y eso decide el diseño:

| Decisión | Por qué |
| --- | --- |
| **Estilos con nombre** (`Heading_20_1`, `Standard`, `Meta`, `List_20_Paragraph`…) | Cambiar el aspecto de todos los títulos es tocar **un** estilo en LibreOffice, no repasar el documento. Es la diferencia con un PDF. |
| Estructura **plana**: título, secciones, entradas | Se pega y se reordena sin pelearse con cajas ni columnas. |
| **El tema, en la parte que se puede heredar** (T-9.26) | Colores, tipografías, tamaños, interlineado y página salen de `theme.toml` y aterrizan en los **estilos con nombre**; la organización sale de su `[layout]`. Lo que no se hereda es el `template.typ`: es código Typst. |
| `<text:s/>` para los espacios seguidos | ODF los colapsa como HTML: sin esto, una sangría del resumen se perdería. |
| Enlaces como `<text:a>` | Un enlace del contacto o de una certificación sigue siendo clicable, y editable. |
| `meta.xml` **sin fecha** | Una fecha de creación haría distinto el mismo documento en cada ejecución. |

El Markdown en línea (negrita, cursiva, código, enlaces) se convierte en estilos de texto automáticos, y las
viñetas de logros en listas de verdad, con su impacto en cursiva entre paréntesis.

## §3.5 El tema, heredado (T-9.26)

El encargo del PO fue «quiero más tipos de CV y algún formato más para el tipo ODT», y la medida previa dijo que
**los tipos ya existían**: 13 de los 37 temas del catálogo son de organización (`kind = "organization"`). Lo que
no existía era la vía: **esos temas solo llegaban al PDF de Typst**, porque su organización vive en el
`template.typ`, que es código. El ODT tenía una sola forma posible.

La cura es partir el tema en dos: lo que ya era declarativo y lo que había que declarar.

| Del tema | Al documento |
| --- | --- |
| `colors.text` / `primary` / `secondary` / `accent` / `rule` | Color del cuerpo; de `Title` y encabezados; de `Subtitle` y `Meta`; del estilo `Internet link`; del filete bajo cada sección. |
| `fonts.body` / `heading` / `mono` | `Standard`; `Title` y encabezados; `Mono` y `Preformatted Text`. |
| `sizes.*` | Cada estilo con su tamaño. **Con una excepción**: `sizes.section` es la *etiqueta* que casi todas las plantillas maquetan pequeña y en versalitas, así que copiada tal cual dejaría los títulos **más pequeños que el cuerpo**; se respeta la escala del tema pero nunca por debajo del texto que encabeza. |
| `spacing.leading` / `paragraph` / `list` | El interlineado de Typst es el hueco **entre** líneas y el de ODF la altura total: `line-height = (1 + leading)`. Los «em» de separación se pasan a centímetros sobre el cuerpo. |
| `page.paper` + `page.margins` | Tamaño de papel (los cinco de Typst) y márgenes, de milímetros a centímetros. |

Y la mitad nueva, `[layout]` en `theme.toml`, que **describe** la organización para las salidas que no ejecutan
Typst. Son tres claves y son deliberadamente pocas:

```toml
[layout]
sections = ["skills", "achievements", "projects", "experience", "education", "certifications", "languages"]
achievements = "consolidated"   # los logros salen de su entrada y van juntos, con la empresa de origen
experience = "compact"          # una línea por puesto: sin resumen ni logros
```

- Las secciones que un tema no nombre van **detrás**, en su orden natural: nunca se pierde ninguna.
- La **portada** —nombre, titular, contacto y resumen— no se mueve: es lo primero en todos los CV del catálogo,
  y hacerla movible sería ofrecer una opción que nadie quiere.
- Con la organización por defecto, `applyLayout` devuelve la vista **tal cual**: el PDF de Typst y el Markdown
  no cambian ni un byte.

**Ocho temas la declaran** (`functional`, `achievements-first`, `skills-first`, `hybrid`, `education-first`,
`project-portfolio`, `ats-plain` y `chronological`) porque su organización cabe en esas tres claves. Los demás
—`sidebar-left`, `two-column-dense`, `europass-like`, `unified-timeline`, `one-page`, `impact-first`— la tienen
en su **maquetación**: columnas laterales, tablas a dos columnas, ejes temporales fusionados, recortes con
«+N». Eso no cabe en tres claves y **fingir que se hereda sería peor que decir qué parte se hereda**: en ODT
mantienen el orden por defecto y sí toman su tipografía y su color.

## §4 Cómo se usa

```bash
cv generate-cv --format odt                          # output/cv-<nombre>.odt
cv generate-cv -s backend --format odt -o mi.odt     # con especialidad y nombre propio
cv generate-cv --format odt --theme functional       # hereda tipografía, color y organización del tema
cv theme list                                        # los temas disponibles, con su clase
```

En la web, en **Generar**, el selector «Formato» tiene la opción **«ODT (documento editable)»**; en **Salidas**
el fichero no se previsualiza —no es texto ni PDF— y se ofrece para descargar, diciendo qué es y con qué se abre.
En la API, `POST /api/v1/generate` con `"format": "odt"`, y `GET /api/v1/output/<nombre>.odt` lo sirve con su
tipo (`application/vnd.oasis.opendocument.text`).

`--engine`, `--theme` y `--template` **no aplican** y se dice por qué; `--stdout` tampoco, porque es binario.

## §5 Fuera de alcance

- **DOCX**: otro formato, mucho más grande de implementar a mano, y ODT ya lo abren Word y Google Docs. Si el PO
  lo pide, es su propia tarea.
- **Volver a importar el ODT editado**: el camino de vuelta ya existe y es mejor —`cv import-cv` lee el PDF o el
  DOCX que exportes, y el borrador se revisa antes de adoptar (`docs/cv-import.md` §10)—.
- **Temas para ODT**: el aspecto se ajusta con los estilos del documento, que es de lo que sirve el formato.
- **Imágenes o fotografía**: el perfil no las guarda (`docs/formato-dataset.md`), así que no hay nada que meter.

## §6 Estado

**ENTREGADO el 2026-09-03.** Verificado con **LibreOffice de verdad**: la prueba convierte el ODT a texto con
`soffice --headless` y comprueba que salen el nombre, las secciones y las viñetas (se omite sola donde no esté
instalado). El arnés determinista genera un ODT **con el binario empaquetado** y lo compara en forma canónica contra su
golden (entradas descomprimidas, por la zlib). Y con el perfil real del PO: `file` responde `OpenDocument Text` y LibreOffice recupera el CV entero,
las 6 experiencias con sus logros, impactos y tecnologías.
