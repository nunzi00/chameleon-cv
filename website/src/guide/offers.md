---
title: Adaptar el CV a una oferta
---
# Adaptar el CV a una oferta de empleo

Guarda la oferta en un fichero de texto **o en PDF** (el texto se extrae en un proceso aislado, con límites de 10 MiB y 50 páginas), o pégala por la entrada estándar, y:

```bash
cv analyze-offer ofertas/acme-backend.txt          # ¿encajo? qué demuestro, qué no y qué me falta
cv generate-cv -f ofertas/acme-backend.txt         # CV afinado: output/cv-<nombre>-acme-backend.md
cv generate-cv -f ofertas/acme-backend.txt -s backend --top-n 4 --max-skills 12
cv generate-cv -f - --compact < oferta.txt         # oferta por stdin, preset de una página
```

Cómo funciona, en tres frases: **`--specialty` elige la versión del CV, `--from-job-offer` la afina y los límites la condensan.**

## El perfil es el diccionario

La oferta se lee buscando tu propio vocabulario: tags, nombres y alias de tus skills (`k8s`, `tech lead`). Lo que la oferta pide y tu perfil ni siquiera tiene etiquetado sale como *carencia*. Si tienes algo y no se reconoce, etiquétalo o añade un alias en `skills.csv`. No hay magia: no se inventan requisitos ni se interpretan sinónimos que tú no hayas declarado.

## Puntuación transparente

Cada requisito pesa según dónde aparece —`Requisitos` 1.0 · resto 0.75 · `Deseable` 0.5, con refuerzo por repetición— y cada ítem suma los pesos de sus etiquetas. Los logros dentro de cada experiencia y las skills se reordenan por puntuación; experiencias, formación, proyectos y certificaciones siguen cronológicos. `--explain` enseña cada número. Especificación: [Extracción de palabras clave y puntuación](/design/scoring).

## Recorte «N mejores»

- `--top-n` limita los logros por experiencia/proyecto y los transversales; `--max-skills`, `--max-projects` y `--max-certifications`, el resto.
- `--compact` equivale a `--top-n 4 --max-skills 12 --max-projects 4 --max-certifications 5`: el preset de una página.
- Los ítems sin etiquetas puntúan 0: van detrás y son los primeros en caer. Sin oferta, todos puntúan 0 y `--top-n` conserva los N primeros tal como los escribiste.
- `#pin` nunca se recorta. Especificación: [Recorte «N mejores» y CLI de adaptación](/design/trimming-cli).

## Elegir a mano qué entra y qué no

Además de los límites por cantidad, puedes decidir tú las skills y los proyectos, **por las dos vías**:

```bash
cv generate-cv --skills "PHP,Kubernetes"          # solo estas
cv generate-cv --exclude-skills "COBOL"           # todas menos estas
cv generate-cv --projects proj-a,proj-b           # solo estos
cv generate-cv --exclude-projects proj-viejo      # todos menos estos
```

Se nombran por **id o por nombre**, y lo que nombres y no exista se avisa en vez de fallar en silencio. Primero
se aplica «solo estas» y después «todas menos estas», así que las dos listas se pueden combinar
(`--skills php,kubernetes --exclude-skills php` deja Kubernetes). Todo esto ocurre **antes** de los límites por
cantidad (`--max-skills` y compañía).

Quitar una skill la saca de tu sección de habilidades; lo que un empleo declare en sus «Tecnologías» es un hecho
de ese empleo y no se reescribe.

En la interfaz web, en «Afinar el contenido», cada selector tiene su conmutador **«Solo estas» / «Todas menos
estas»**: la misma lista, leída al derecho o al revés.

## `cv analyze-offer`

Analiza sin generar: adecuación global, evidencias (qué ítems del perfil demuestran cada requisito) y carencias. `--explain` da la auditoría por ítem; `--json` lo mismo en JSON para scripts; `-s` acota el análisis a una especialidad; `<offer>` puede ser `-` (stdin). Referencia: [`cv analyze-offer`](/reference/analyze-offer).

## Refinar la lectura de la oferta con el co-piloto

El emparejado es **literal**: si la oferta pide «arquitectura orientada a eventos» y tus skills dicen «Kafka», no
hay coincidencia salvo que exista un alias. `--copilot` añade una segunda lectura de la oferta con un modelo:

```sh
cv analyze-offer ofertas/acme-backend.txt --copilot            # co-piloto local (Ollama y demás)
cv analyze-offer ofertas/acme-backend.txt --copilot --provider groq --yes
```

Lo que hace, y lo que no:

- **El modelo lee la oferta; no decide tu CV.** Devuelve el mismo cuadro de requisitos de siempre y, a partir de
  ahí, la selección, la puntuación y el informe son exactamente los de hoy. Sin `--copilot` no hay red ni cambio
  alguno en el resultado.
- **Solo puede AÑADIR etiquetas que ya son tuyas.** Se le envían el texto de la oferta —que es público— y la
  lista de tus etiquetas; nada más de tu perfil. No puede inventarte una habilidad: si propone una etiqueta que
  no está en esa lista, el código la descarta.
- **Cada propuesta necesita una frase de la oferta**, y el código comprueba que esa frase **está literalmente**
  en ella. Lo que no se pueda verificar se descarta y se cuenta.
- **Ves siempre lo que aportó, con su evidencia**: `arquitectura (desirable) ← «sistemas de mensajería»`. El
  código puede verificar que la frase existe; que *sostenga* la etiqueta lo juzgas tú, y para eso se te enseña.
- **Nunca pesa más que lo literal.** Una etiqueta añadida por el co-piloto vale como una evidencia única, sin
  refuerzo por repetición: un término que la oferta nombra tres veces siempre pesa más.
- `--explain` marca su origen: `sistemas de mensajería (desirable, 0.75, co-piloto)`. Sin eso no sabrías qué
  parte de tu adecuación descansa en un modelo.
- Con un proveedor remoto, aviso de coste y confirmación antes de enviar (`--yes` en scripts).

En la interfaz web es la casilla **«Refinar la lectura con el co-piloto»**, junto a «Analizar oferta», con su
selector de proveedor: lo aportado aparece dentro del panel de adecuación, con la misma evidencia y el mismo
recuento de descartes, y un proveedor remoto abre antes el diálogo de coste. En la API, `POST /analyze-offer`
acepta `copilot` (403 `remote-disabled` sin `--allow-remote`, 409 `consent-required` con `estimateId`).

### Que el puente deje de hacer falta

Si la frase que el co-piloto tuvo que tender ya te sirvió una vez, lo barato y permanente es que quede como
**alias** de tu skill. `--save-aliases` lo hace por ti:

```sh
cv analyze-offer ofertas/acme-backend.txt --copilot --save-aliases
#   alias guardado en Apache Kafka: «sistemas de mensajería» (kafka)
#   1 alias en data/sources/skills.csv: la próxima oferta que lo diga así se reconocerá sin modelo.
cv build
```

A partir de ahí, **esa oferta y las que hablen igual se resuelven sin red y sin modelo**: lo reconoce el
emparejado literal.

**Eliges tú cuáles.** En la terminal se pregunta **una a una** («¿Guardar «sistemas de mensajería» como alias de
tu etiqueta «kafka»?»); con `--yes`, o sin terminal, entran todas las que el código dio por buenas, que es lo que
espera un script. En la web, cada aportación del co-piloto lleva su casilla y **ninguna viene marcada**: marcas
las que quieras y pulsas «Guardar N como alias».

Dos guardas más: solo se guarda lo que el código verificó, y solo cuando la etiqueta pertenece a **una sola**
skill —si son varias, el alias no es de ninguna en particular y se te dice para que elijas tú—. Lo que ya se
reconocía tampoco se duplica. La frase se guarda **normalizada** (minúsculas y sin diacríticos), que es como el
emparejado la busca y la única forma que admite `skills.csv`; lo que no quepa como alias se dice y no se escribe.
La escritura es quirúrgica: se añade al final de la columna `aliases` de esa fila y **el resto del fichero queda
byte a byte igual**.

## Generar con la adecuación

Analizar y generar están conectados (T-8.9):

- **Especialidad sugerida.** `cv analyze-offer` imprime la especialidad real del perfil cuyas tags más pesan entre los
  requisitos reconocidos («Especialidad sugerida: backend (…; cubre 5 de 8 requisitos con peso)»). En la CLI solo
  se imprime; en la pantalla Generar, si el paso 1 estaba vacío, se rellena con ella y se avisa.
- **Evidencias conservadas.** Al generar con oferta, los ítems que demuestran algún requisito (logros, skills,
  proyectos y certificaciones con términos coincidentes) **no se recortan por los límites de cantidad**
  (`--top-n`, `--compact`, `--max-*`): cuentan para el límite y se cortan los demás. `--explain` los lista
  («evidencias conservadas por la oferta (no se recortan): …») y la API los devuelve en `report.kept`.
  `--no-keep-evidence` (CLI) o `keepEvidence: false` (API) recuperan el recorte puro por puntuación.
- **Un gesto en la interfaz.** El panel de adecuación tiene «Generar con esta adecuación»: conserva la oferta, usa la
  especialidad (sugerida o elegida) y genera; el aviso de éxito dice cuántas evidencias se conservaron.

## Ofertas en PDF

El PDF se procesa en un *worker* aislado con límites (10 MiB, 50 páginas, 20 s, 512 MB), sin cargar fuentes ni renderizar; solo se extrae el texto. Un PDF escaneado sin capa de texto no aporta nada: pega el texto a mano.

Tutorial paso a paso: [Un CV para tres ofertas](/tutorials/three-offers).

## Historial de ofertas procesadas

Cada `cv analyze-offer` y cada `cv generate-cv --from-job-offer` deja una entrada en `output/historial-ofertas.json` (fecha, acción, especialidad y CV escrito) identificada por la **huella del texto** de la oferta. Al volver a usar la misma oferta —pegada, extraída de su PDF o desde un fichero— el producto te lo dice antes del resultado:

```text
Esta oferta ya se procesó 2 veces:
  2026-08-30T12:10:33.000Z · generate-cv (backend) → output/cv-ada-backend-nexo.pdf
  2026-08-29T09:00:00.000Z · analyze-offer (backend)
```

En la interfaz web el aviso aparece en Generar en cuanto añades la oferta; en la API, `POST /api/v1/offers/history` consulta el historial sin efectos y las respuestas de `/analyze-offer` y `/generate` lo incluyen (`history`). El fichero es tuyo: puedes borrarlo o editarlo; se conservan las 500 entradas más recientes.

## Desde una URL (T-8.5)

Una oferta publicada en la web se trae con **una sola petición https, sin cookies ni datos tuyos** (máximo 2 MiB y 15 s, con guardia contra direcciones internas). La extracción prefiere el `JSON-LD JobPosting` de la página (LinkedIn, Jobgether, Manfred…), cae al contenido principal cuando la descripción es un resumen, y a los metadatos `og:*` en última instancia; la **procedencia** y los avisos se muestran siempre.

```bash
cv analyze-offer "https://empresa.com/ofertas/backend" --allow-remote        # pide confirmación (o --yes para scripts)
cv generate-cv -f "https://empresa.com/ofertas/backend" --allow-remote --yes --save-offer
cv analyze-offer --list                                                      # qué hay guardado en offers/
```

`--save-offer [ruta]` guarda el texto en `offers/` con cabecera de origen (`--replace` para sustituir). En la **interfaz web**, la pestaña «URL» del paso Oferta de Generar hace lo mismo con un diálogo de consentimiento (host y límite a la vista) y un «Guardar en offers/ como…»; la pestaña «Del espacio» ofrece el selector con lo ya guardado.

