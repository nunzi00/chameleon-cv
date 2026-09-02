## Ejemplos

```bash
cv drafts show cv-lucas                        # las entradas del borrador, con el id que hay que señalar
cv build --data import/cv-lucas                # y su validación completa, la misma que la de tus fuentes
```

- Lista las experiencias, formaciones y proyectos con su id, su periodo y cómo se leen. El **id** es lo que pide
  `cv drafts adopt --entry`.
- Un periodo abierto se ve como `2022-04 → …` y uno sin fechas como `—`: el importador no inventa una fecha que el
  CV no traía.
- Lo que no se pudo situar y lo que se degradó están en `import/<nombre>/README.md`; corrígelo ahí (o desde la
  pantalla «Borradores») antes de adoptar.
