# PoC T-3.1: Typst sobre el `CvView` de Chameleon CV

- `cv.typ`: plantilla Typst que maqueta el diccionario derivado de `CvView` (+ `inline.ts`: Markdown en línea como *runs*).
- `cv-backend.json`: datos del CV backend de `docs/selector-engine.md` §5.4 tal y como los recibiría la plantilla.
- `main.typ`: documento principal de reproducción (lee el JSON del fichero; en producción viaja por stdin como literal).

Reproducir (Typst 0.15.1, desde la raíz del repositorio):

```bash
typst compile docs/poc/typst/main.typ cv-backend.typst.pdf \
  --root docs/poc/typst --font-path templates/fonts --ignore-system-fonts --creation-timestamp 946684800
```

Resultado esperado: una página, ~40 KB, determinista, PDF etiquetado, y `extractPdfText` (T-2.5) devuelve exactamente
`tests/fixtures/golden/cv-backend.pdf.txt`. Detalles, sondas de contención y medidas en `docs/typst-integration.md`.
