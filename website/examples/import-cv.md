## Ejemplos

```bash
cv import-cv cv-antiguo.pdf                    # borrador de fuentes en import/<nombre>/ con README de lo reconocido
cv import-cv cv-antiguo.docx --name mi-cv      # también DOCX (word/document.xml); carpeta destino a tu gusto
cv import-cv cv-antiguo.pdf --replace          # sustituye un borrador anterior con el mismo nombre
cv build --data import/mi-cv                   # valida el borrador antes de moverlo a data/sources/
```

- Importa un CV ya maquetado como **borrador**: nunca escribe en `data/sources/`. El PDF se lee con el mismo worker
  contenido del producto (límites de páginas, memoria y tiempo) y su orden de lectura se reconstruye desde la
  maquetación (columnas laterales, tablas con fechas al margen, viñetas partidas).
- Determinista y sin inventar: lo que no se entiende va al `README.md` del borrador («Degradado o avisado» y
  «Sin situar», con la línea de origen), y cada fichero lleva la cabecera `BORRADOR importado de <fichero>`.
- Revisa, ajusta y muévelo a mano (o con `cv import` desde un perfil JSON exportado) cuando esté a tu gusto.
- En la interfaz web (`cv serve`), la pantalla **Importar CV** (grupo Perfil) hace lo mismo: eliges el fichero, opcionalmente el nombre, y ves el resumen y el informe del borrador; si ya existe, te ofrece sustituirlo.
