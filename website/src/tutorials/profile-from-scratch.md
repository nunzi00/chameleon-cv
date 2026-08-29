---
title: 1 · Tu perfil desde cero
verify:
  - data/dist/profile.json
  - output/cv-marta-rio-backend.md
  - output/cv-marta-rio-backend.pdf
  - output/cv-marta-rio.md
---
# Tutorial 1 · Tu perfil desde cero

Vas a crear un espacio de trabajo, sustituir el perfil de ejemplo por el tuyo, añadir una experiencia con logros etiquetados y una skill, y generar el CV en Markdown y en PDF. Al terminar sabrás leer `--explain` para entender por qué el CV es el que es.

## 1. El espacio de trabajo

```bash
mkdir mi-cv && cd mi-cv
```

```bash tutorial
cv init
find data/sources -type f | sort
```

`cv init` crea `data/sources/` con la persona sintética «Ada Ejemplo» y un `.gitignore`. Mira cualquiera de los ficheros: cada uno es un Markdown con frontmatter YAML para los datos y cuerpo para el texto.

## 2. Tus datos personales

Sustituye `profile.md` por el tuyo. Solo `fullName` es obligatorio; el resto describe la cabecera del CV:

```bash tutorial
cat > data/sources/profile.md <<'EOF'
---
schemaVersion: 1
locale: es-ES
updatedAt: 2026-08-29
fullName: Marta Río
headline: Ingeniera de plataforma
email: marta@example.com
phone: +34 600 111 222
location:
  city: Valencia
  region: Comunidad Valenciana
  country: España
links:
  - label: GitHub
    url: https://github.com/marta-rio
languages:
  - { name: Español, level: native }
  - { name: Inglés, level: C1 }
---

Ingeniera de plataforma con **8 años** operando servicios en la nube para equipos de producto.
EOF
```

## 3. Una experiencia con logros etiquetados

Cada experiencia es un fichero; los logros son viñetas con sus etiquetas al final y, si quieres, `impact:` y `date:`:

```bash tutorial
cat > data/sources/experience/nube.md <<'EOF'
---
company: Nube SA
role: Platform Engineer
location: Valencia (híbrido)
start: 2019-01
end: 2023-12
tags: [kubernetes, devops]
technologies: [Kubernetes, Terraform, Go]
---

Plataforma interna para 40 equipos de producto.

## Logros

- Automaticé el aprovisionamiento con Terraform: de **3 días a 20 minutos** por entorno. #devops #kubernetes
  - impact: -99 % tiempo de aprovisionamiento
  - date: 2021-06
- Diseñé la observabilidad común (métricas, trazas y logs) de 120 servicios. #platform #devops
EOF
```

Fíjate en las etiquetas: `#kubernetes` está en el vocabulario de la especialidad `backend` del ejemplo (`specialties/backend.md`: `php, symfony, kubernetes, kafka`); `#platform` y `#devops`, no. Eso decidirá qué logro entra en el CV de backend.

## 4. Una skill más

`skills.csv` es una tabla plana; `|` separa varios valores:

```bash tutorial
printf 'Terraform,platform,advanced,4,,devops|platform\n' >> data/sources/skills.csv
tail -3 data/sources/skills.csv
```

## 5. Valida y compila

```bash tutorial
cv validate
cv build
```

Silencio es buena señal. Si te equivocas —prueba a poner `start: 2019-13` en `nube.md`— verás **todos** los errores a la vez, con fichero, línea y clave, y no habrá artefacto hasta que los corrijas:

```
experience/nube.md:5: start: Fecha inválida: «2019-13»
```

## 6. Genera

```bash tutorial
cv generate-cv -s backend
cv generate-cv -s backend --format pdf
cv generate-cv
ls output
```

Tres ficheros: el CV de la especialidad `backend` en Markdown y en PDF, y el CV completo. Abre `output/cv-marta-rio-backend.md`: la experiencia en Nube SA aparece con **un solo logro**, el de Terraform.

## 7. Entiende la selección

```bash tutorial
cv generate-cv -s backend --explain --stdout > /dev/null
```

En stderr verás algo así:

```
+ experience exp-nube: match (kubernetes)
    + exp-nube-1: match (kubernetes)
    - exp-nube-2: no-match
```

La regla: **sin etiquetas, siempre; con etiquetas, solo si alguna coincide**. El segundo logro (`#platform #devops`) no comparte ninguna etiqueta con `backend`, así que no entra en ese CV —pero sí en el completo—. Si quieres que aparezca en backend, añade `#kubernetes` a la viñeta o `platform` al vocabulario de la especialidad. Y si un ítem debe salir siempre, en toda especialidad y oferta: `#pin`.

## Siguiente

[Un CV para tres ofertas](./three-offers): la misma mecánica, guiada por lo que pide cada oferta.
