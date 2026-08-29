## Ejemplos

```bash
cv typst install            # descarga el release oficial 0.15.1 para tu plataforma, lo verifica y lo instala
cv typst install --force    # reinstala aunque ya esté
```

- Es la **única operación de red** de `cv`, y solo ocurre cuando tú la pides: descarga por https con límite de tamaño, SHA-256 comprobado contra el manifiesto fijado en el repositorio (un fichero alterado se elimina sin instalarse), extracción en un directorio temporal y comprobación de `--version` antes de colocar el binario en la caché de usuario (`~/.cache/chameleon-cv/typst/0.15.1/typst`, permisos 0700).
- También sirve un Typst 0.15.1 ya instalado: en el `PATH`, en la variable `CHAMELEON_TYPST` o con `--typst-path` en `generate-cv`.
