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
| **Sin tema ni motor** | El aspecto se ajusta en el propio documento; los temas de Typst son para el PDF. |
| `<text:s/>` para los espacios seguidos | ODF los colapsa como HTML: sin esto, una sangría del resumen se perdería. |
| Enlaces como `<text:a>` | Un enlace del contacto o de una certificación sigue siendo clicable, y editable. |
| `meta.xml` **sin fecha** | Una fecha de creación haría distinto el mismo documento en cada ejecución. |

El Markdown en línea (negrita, cursiva, código, enlaces) se convierte en estilos de texto automáticos, y las
viñetas de logros en listas de verdad, con su impacto en cursiva entre paréntesis.

## §4 Cómo se usa

```bash
cv generate-cv --format odt                      # output/cv-<nombre>.odt
cv generate-cv -s backend --format odt -o mi.odt # con especialidad y nombre propio
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
