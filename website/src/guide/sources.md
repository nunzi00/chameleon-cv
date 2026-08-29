---
title: Formato de las fuentes
---
# Formato de las fuentes

Un dataset es un directorio con esta forma (especificación completa en las notas de diseño [Formato del dataset](/design/formato-dataset) y [Formato CSV](/design/formato-csv); `cv init` crea uno de ejemplo):

```
data/sources/
├── profile.md            # datos personales, idiomas y resumen por defecto (obligatorio)
├── specialties/*.md      # una «versión» de tu CV por fichero: backend.md, engineering-manager.md…
├── experience/*.md       # una experiencia por fichero
├── projects/*.md         # un proyecto por fichero
├── education/*.md        # una formación por fichero
├── achievements.md       # logros transversales (premios, ponencias…)
├── skills.csv            # habilidades
└── certifications.csv    # certificaciones
```

Reglas que conviene saber: las claves son las del esquema (en inglés); una clave, sección o fichero desconocidos son un **error** (nada se ignora en silencio); las fechas son `YYYY`, `YYYY-MM` o `YYYY-MM-DD`; el YAML es estricto (sin tipado implícito ni alias); solo se leen ficheros `.md`/`.csv` dentro del dataset y los enlaces simbólicos que apuntan fuera son un error.

## `profile.md`

Frontmatter con los datos personales y cuerpo con el resumen por defecto (Markdown):

```markdown
---
schemaVersion: 1
locale: es-ES
updatedAt: 2026-08-28
fullName: Ada Ejemplo
headline: Ingeniera de software
email: ada@example.com
phone: +34 600 000 000
location:
  city: Madrid
  region: Comunidad de Madrid
  country: España
links:
  - label: GitHub
    url: https://github.com/ada-ejemplo
languages:
  - { name: Español, level: native }
  - { name: Inglés, level: C1 }
---

Ingeniera de software con **10 años** construyendo plataformas de pago.
```

`fullName` es lo único obligatorio; el nombre del fichero de salida sale de él (`cv-ada-ejemplo-…`). Las URL solo admiten `http(s)`.

## Especialidades: `specialties/<id>.md`

```markdown
---
title: Senior Backend Engineer
tags: [php, symfony, kubernetes, kafka]
---

Resumen específico para este tipo de puesto (opcional; si falta, se usa el de profile.md).
```

El `id` es el nombre del fichero (`backend`); una especialidad no puede llamarse `pin` ni usar esa etiqueta.

## Experiencias, proyectos y formación

Cada entidad es un fichero Markdown con **frontmatter YAML para los datos y cuerpo para el texto**:

```markdown
---
company: ACME Corp
role: Senior Backend Engineer
location: Madrid (remoto)
start: 2021-03
end: 2024-06                 # vacío o ausente = en curso
tags: [php, symfony]
technologies: [PHP 8.3, Symfony 6.4]
---

Resumen de la experiencia, en Markdown.

## Logros

- Reduje la latencia p95 un **40 %**. #performance #php
  - impact: -40 % p95
  - date: 2023-05
- Lideré la migración a Kubernetes sin ventana de parada. #kubernetes #pin
  - id: exp-acme-k8s
```

- **Proyectos** (`projects/<id>.md`): `name`, `role`, `url`, `start`, `end`, `technologies`, `tags`; la sección de logros puede llamarse `## Logros` o `## Achievements`.
- **Formación** (`education/<id>.md`): `institution`, `degree`, `field`, `start`, `end`.
- **Logros transversales** (`achievements.md`): una lista de viñetas con la misma sintaxis, sin frontmatter.

### Sintaxis de las viñetas de logro

- El texto admite Markdown en línea (negrita, cursiva, código, enlaces).
- Las **etiquetas** van al final: `#performance #php`. `#pin` ancla el logro.
- Las sublíneas opcionales aportan metadatos: `impact:` (se muestra entre paréntesis en el CV), `date:` y `id:` (identificador explícito; por defecto `exp-acme-1`, `exp-acme-2`…).

## `skills.csv`

```csv
name,category,level,years,aliases,tags
PHP,language,expert,10,,php|backend
Kubernetes,platform,advanced,5,k8s,kubernetes|devops|platform
Liderazgo técnico,soft,advanced,,tech lead|team lead,liderazgo
```

`|` separa varios valores en `aliases` y `tags`. Los **alias** importan al leer ofertas: si una oferta dice «k8s» y tu skill tiene ese alias, cuenta como evidencia. Las categorías agrupan la sección de habilidades del CV.

## `certifications.csv`

```csv
name,issuer,date,url,tags
CKA,CNCF,2022-05-10,https://example.com/cert/cka,kubernetes|devops
```

## Errores

`cv validate` y `cv build` muestran **todos** los problemas a la vez, con fichero, línea y clave:

```
experience/acme.md:4: start: Fecha inválida: «2021-13»
skills.csv:3: level: valor desconocido «guru» (expert, advanced, intermediate, beginner)
```

Código de salida 1 mientras haya algún error; 0 cuando el dataset está limpio.
