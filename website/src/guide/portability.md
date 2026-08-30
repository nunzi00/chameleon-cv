# Exportar e importar el perfil

Desde la versión 1.4.0, el perfil canónico —el mismo JSON que `cv build` escribe en `data/dist/profile.json`— entra y sale del producto con dos órdenes: `cv export` y `cv import`. Sirven para guardar una copia estructurada, editarla o consultarla con otras herramientas (`jq`, un editor de JSON, un script) y para empezar un proyecto a partir de un perfil existente. Las fuentes Markdown y CSV siguen siendo la única fuente de verdad: importar **regenera** las fuentes, no las sustituye por el JSON.

## Exportar

```bash
cv export > perfil.json                  # por la salida estándar
cv export -o copias/perfil-2026.json     # a un fichero (permisos 0600)
cv export | jq '.skills[].name'          # consultarlo
```

- Sale de las fuentes, no del artefacto: no hace falta `cv build` y nunca está desactualizado. Si las fuentes tienen problemas, los muestra todos a la vez —como `cv validate`— y no exporta nada.
- El JSON es exactamente el de `data/dist/profile.json` (mismas claves, mismo orden, dos espacios, salto final), con `meta.schemaVersion` para saber qué versión del esquema habla.
- Contiene lo que pusiste en `profile.md`, incluidos el correo y el teléfono: sale solo a donde tú lo mandas y nunca por la red.

## Importar

```bash
cv import perfil.json --dry-run          # el plan y el auto-chequeo, sin escribir nada
cv import perfil.json                    # regenera data/sources/ (solo si está vacío o no existe)
cv import perfil.json -d data/nuevo      # a otro directorio de fuentes
cv import perfil.json --replace          # sustituye las fuentes actuales; las apartadas quedan en data/sources.<fecha-hora>.bak/
cv export | cv import - -d data/copia    # de un proyecto a otro
cv build                                 # después de importar, regenera el artefacto
```

`cv import` es la inversa de `cv build`: a partir del perfil escribe `profile.md`, `specialties/`, `experience/`, `projects/`, `education/`, `achievements.md`, `skills.csv` y `certifications.csv` con la disposición y las convenciones de `cv init` (ver [Fuentes regeneradas](/design/formato-dataset#15-fuentes-regeneradas-por-cv-import)). Antes de tocar el disco hace tres cosas:

1. **Valida** el perfil con el esquema estricto: todos los problemas a la vez, con su ruta (`experience[2].dates.start: …`), y rechaza las versiones de esquema que no entiende.
2. **Comprueba que se puede representar**: un logro con saltos de línea, o cuya última palabra empiece por `#` (se leería como etiqueta), no cabe tal cual en las fuentes; lo dice y no escribe nada.
3. **Se comprueba a sí mismo**: vuelve a leer las fuentes que va a escribir con el mismo parser que usa `cv build` y compara el perfil resultante con el importado. A la primera diferencia, no escribe nada y enumera las rutas que difieren. Es la garantía de que `cv build` reconstruirá exactamente lo que importaste.

Solo entonces escribe, y solo en un directorio de fuentes **vacío o inexistente**. Si el directorio tiene contenido, hace falta `--replace`: el directorio entero se renombra antes como copia (`data/sources.20260830-120102.bak/`, nunca sobrescrita) y después se escriben las fuentes nuevas, con permisos `0600`. Si una escritura fallara a medias, el resumen dice qué se escribió y dónde sigue la copia.

### Qué se conserva y qué no

- **Se conserva todo el perfil**: ids de entidades y de logros, etiquetas, impactos, fechas, resúmenes con sus párrafos, alias y niveles. El orden de los logros, de las skills y de las certificaciones también.
- **El orden de las entidades** (experiencias, proyectos, formación, especialidades) pasa a ser el de sus ficheros —el id sin su prefijo por defecto, como `exp-acme` → `acme.md`—, que es el orden en que `cv build` los lee. Si el perfil los traía en otro orden, `import` avisa.
- **No se conserva el formato** de las fuentes anteriores: comentarios, saltos de línea del frontmatter, orden de las claves. Importar regenera fuentes canónicas; no es una edición. Para cambiar una frase, edita la fuente (o usa la interfaz web); para fusionar dos perfiles, importa a un directorio nuevo y copia a mano lo que quieras.

### Desde la interfaz web y la API

En la pantalla **Estado** de `cv serve`, **Exportar perfil (JSON)** descarga el perfil y **Importar perfil…** elige un fichero, muestra el plan (ficheros, tamaños, avisos, auto-chequeo) y solo escribe tras confirmar, con la casilla «sustituir las fuentes actuales» cuando el directorio no está vacío. En la API, `GET /api/v1/export` y `POST /api/v1/import` (`dryRun` por defecto: primero el plan) hacen lo mismo; ver la [referencia de la API](/reference/api).

## Códigos de salida

| Situación | Código |
|---|---|
| Perfil inválido, irrepresentable o distinto tras regenerar; destino con contenido sin `--replace` | 1 |
| Fichero inexistente o ilegible; no se pudo escribir o apartar el directorio | 2 |
