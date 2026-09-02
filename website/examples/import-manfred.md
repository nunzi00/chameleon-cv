## Ejemplos

```bash
cv import-manfred my-mac-from-manfred.json          # borrador en import/<nombre>/ con su informe
cv import-manfred mac.json --name manfred           # carpeta destino a tu gusto
cv import-manfred mac.json --replace                # sustituye un borrador anterior (lo aparta como copia)
cv build --data import/manfred                      # valida el borrador antes de adoptar nada
cv drafts show manfred                              # y adopta lo que quieras con «cv drafts adopt»
```

- El **MAC** («Manfred Awesome CV») es el JSON que [Manfred](https://www.getmanfred.com) te deja exportar de tu
  perfil. Trae los datos **estructurados**, así que no hay maquetación que adivinar y **no queda nada sin situar**.
- Se importan el perfil, los enlaces, la experiencia (**una entrada por rol**, con sus retos como logros y sus
  competencias como tecnologías), los proyectos, la formación, las certificaciones (`studyType: certification`),
  las habilidades y los idiomas, con los cinco niveles traducidos al MCER.
- Lo que un MAC guarda y este perfil no —los puestos y el contrato que buscas, tu salario, el estado de búsqueda,
  las recomendaciones— **no se importa y se te dice** en el informe del borrador.
- **Sin red**: el `$schema` que declara el fichero no se descarga. Una versión distinta de la 0.5 se avisa y se
  importa igual.
- Como todo importador, escribe en `import/`, **nunca** en `data/sources/`.
