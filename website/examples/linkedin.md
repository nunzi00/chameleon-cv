## Ejemplos

```bash
cv linkedin                                  # qué poner en LinkedIn, a partir de tus fuentes
cv linkedin --draft profile                  # comparando con lo que exportaste de LinkedIn
cv linkedin --draft profile --json           # el plan en JSON
```

- **Cómo exportar tu perfil de LinkedIn**, de mejor a peor: *Configuración y privacidad → Privacidad de los datos → Obtener una copia de tus datos*, marcando **«Quiero algunos datos»** con *Positions*, *Education*, *Skills*, *Languages* y *Profile* (llega un `.zip` en minutos, con los datos **estructurados**); o *tu perfil → Más → Guardar como PDF*, que es inmediato pero reconoce menos porque hay que adivinar la maquetación. No pidas «todos los datos»: tarda hasta 24 horas y trae mensajes y anuncios que no son un CV.
- **Cómo importarlo aquí**: el `.zip` con `cv import-linkedin <fichero.zip>`, el PDF con `cv import-cv <fichero.pdf>`. Las dos dejan un **borrador** en `import/<nombre>/`; nunca escriben en tus fuentes.
- El plan sale en **tres bloques**: qué **añadir** en LinkedIn (está en tus fuentes y no allí), qué **corregir** (está en los dos y no dice lo mismo; tus fuentes son la referencia) y qué **falta por actualizar** en tu propio perfil antes de subirlo —puestos sin logros, sin etiquetas, sin certificaciones—.
- **Sin `--draft` no se puede decir qué corregir**: solo qué tienes tú. Es lo que necesita quien todavía no ha exportado nada.
- No hay modelo ni red: es un diff local entre dos perfiles, con la misma regla de identidad que usa `cv duplicates`.
