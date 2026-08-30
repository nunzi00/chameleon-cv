# Importar un CV existente (PDF/DOCX) a las fuentes (T-8.4b) — PROPUESTA v1

Estado: APROBADA por el PO (2026-08-30, D1–D5) · Orden del Director · Se implementa tras T-8.5 S1–S2 (1.9.0)

## §0 Encargo

Director, 2026-08-30: «necesito que proceses […] la parte de importación de cv; para esa parte, creo que la ayuda de llm
puede ser de ayuda». Antecedentes: T-8.4 (spike, veredicto «Go limitado»): P3 (reconstrucción determinista desde la
maquetación del PDF) es el núcleo; P2 (modelo local de extremo a extremo) queda fuera del flujo por defecto por lento y
no determinista. La pregunta original del Director («¿dónde tenemos el importador de doc/pdf?») ya señaló la necesidad.

## §1 Qué hay hoy

`cv import <perfil.json>` (la inversa de `cv build`, con auto-chequeo); el spike en `scripts/spike/pdf-import/` con el
corpus sintético, el arnés de métricas y los tres candidatos medidos; `extractPdfText` endurecido en un worker; el
co-piloto con revisiones verificadas (C2) y, desde T-8.13, `qwen3:8b` por defecto con razonamiento conmutable.

## §2 Propuesta (dos fases, el LLM ayuda pero nunca decide)

1. **Fase determinista (P3, el núcleo)**: `cv import-cv <fichero.pdf>` extrae la maquetación (líneas, tamaños,
   negritas, posiciones) con el código del spike endurecido en `src/import/`, segmenta secciones (experiencia,
   formación, habilidades, certificaciones, idiomas) por tipografía y palabras clave, y produce un **borrador de
   fuentes** en `import/<nombre>/` (nunca sobre `data/sources/`): `profile.md`, `experience/*.md`, `skills.csv`… con
   una cabecera «BORRADOR importado de <fichero> el <fecha>» y un informe de lo que no se pudo situar.
2. **Asistente del co-piloto (la ayuda del LLM que pide el Director)**: `cv import-cv --copilot` (y en la GUI un botón
   «Refinar con el co-piloto») envía los fragmentos ambiguos —seudonimizados como improve/summarize— al modelo local
   para proponer el mapeo (¿esto es un logro o un resumen?, ¿la fecha es 2019–2021?, etiquetas del diccionario), y las
   propuestas llegan como **revisión** estándar (fichero de revisión + `cv improve apply` con historial de T-8.10):
   verificación C2 (nada que no esté en el texto origen), nunca escritura directa. Sin `--copilot`, cero red y cero LLM.
3. **DOCX**: conversión a texto con el mismo tokenizador de ofertas (docx = zip + XML; extractor propio sin
   dependencias, solo `word/document.xml` con los párrafos y estilos básicos); la maquetación fina queda para PDF.
4. `cv build --data import/<nombre>` permite validar el borrador antes de moverlo a mano (o con `cv import` una vez
   revisado) a `data/sources/`.

## §3 Fuera de alcance

OCR de PDF escaneados; fotos y diseño; importación directa a `data/sources/` sin revisión; LinkedIn export (otro
formato, otra tarea).

## §4 Pruebas

Corpus del spike + 3 CV reales del Director (anonimizados como en T-8.5); 100 % de `src/import/**`; arnés `import-cv-*`
con PDF del banco (generados por los propios temas: los 27 temas de T-8.12 son un corpus perfecto de maquetaciones);
métrica del spike como prueba con umbrales; el asistente del co-piloto con el doble del proveedor.

## §5 Decisiones que se piden al PO

1. **D1** Dos fases: núcleo determinista P3 + asistente opcional del co-piloto (`--copilot`), con las propuestas como
   revisión C2 y el historial de T-8.10.
2. **D2** Borrador en `import/<nombre>/`, nunca escritura directa en `data/sources/`.
3. **D3** DOCX con extractor propio mínimo (document.xml); la maquetación fina, solo PDF.
4. **D4** Los PDF de los 27 temas del banco como corpus de regresión, más 3 CV reales anonimizados del Director.
5. **D5** Se implementa tras T-8.5 S1–S2 (la URL primero, como ordenó el Director), con destino 1.9.0.
