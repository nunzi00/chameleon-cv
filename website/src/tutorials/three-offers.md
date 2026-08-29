---
title: 2 · Un CV para tres ofertas
verify:
  - output/cv-ada-ejemplo-backend-acme-backend.md
  - output/cv-ada-ejemplo-nube-platform.md
  - output/cv-ada-ejemplo-engineering-manager-lider-equipo.md
  - informes/acme-backend.json
---
# Tutorial 2 · Un CV para tres ofertas

Tres ofertas distintas, un solo perfil. Verás cómo `cv analyze-offer` mide la adecuación, qué demuestra tu perfil y qué le falta, y cómo `--from-job-offer` afina el CV a cada una. Partimos del perfil de ejemplo (`cv init`), que ya tiene dos especialidades: `backend` y `engineering-manager`.

## 1. Espacio de trabajo y tres ofertas

```bash tutorial
cv init
cv build
mkdir -p ofertas informes
cat > ofertas/acme-backend.txt <<'EOF'
Senior Backend Engineer (PHP)

Requisitos:
- PHP 8 y Symfony en producción.
- Kubernetes: despliegues sin parada.
- Kafka o mensajería equivalente.

Deseable:
- Contract testing entre servicios.
EOF
cat > ofertas/nube-platform.txt <<'EOF'
Platform Engineer

Requisitos:
- k8s y automatización de infraestructura.
- Observabilidad: métricas, trazas y logs.
- Go o TypeScript.

Deseable:
- Certificación CKA.
EOF
cat > ofertas/lider-equipo.txt <<'EOF'
Engineering Manager

Requisitos:
- Liderazgo de equipos de 5 a 10 personas.
- Gestión de la entrega con metodologías ágiles.
- Mentoría y desarrollo de carrera.
EOF
```

Las secciones importan: lo que va bajo `Requisitos` pesa 1.0, el resto 0.75 y lo que va bajo `Deseable` 0.5, con refuerzo si un término se repite.

## 2. ¿Encajo? Analiza sin generar nada

```bash tutorial
cv analyze-offer ofertas/acme-backend.txt
cv analyze-offer ofertas/nube-platform.txt
cv analyze-offer ofertas/lider-equipo.txt
```

Cada informe dice la adecuación global, las **evidencias** (qué ítems de tu perfil demuestran cada requisito) y las **carencias**: lo que la oferta pide y tu perfil ni siquiera tiene etiquetado. El perfil es el diccionario: «k8s» cuenta porque la skill Kubernetes del ejemplo tiene ese alias en `skills.csv`; «Terraform» no aparece en el perfil de Ada y sale como carencia. Si tienes algo y no se reconoce, etiquétalo o añade un alias.

```bash tutorial
cv analyze-offer ofertas/acme-backend.txt --explain
cv analyze-offer ofertas/acme-backend.txt --json > informes/acme-backend.json
```

`--explain` audita ítem a ítem qué puntuó cuánto; `--json` da lo mismo para scripts.

## 3. Un CV para cada oferta

```bash tutorial
cv generate-cv -f ofertas/acme-backend.txt -s backend --top-n 4 --max-skills 12
cv generate-cv -f ofertas/nube-platform.txt
cv generate-cv -f ofertas/lider-equipo.txt -s engineering-manager --compact
ls output
```

Tres reglas en una frase: **`--specialty` elige la versión del CV, `--from-job-offer` la afina y los límites la condensan.**

- El primero parte de la versión `backend` y reordena los logros y las skills según lo que pide ACME.
- El segundo no fija especialidad: usa el perfil completo, ordenado por la oferta.
- El tercero usa la versión `engineering-manager` con el preset de una página (`--compact` = `--top-n 4 --max-skills 12 --max-projects 4 --max-certifications 5`).

El nombre del fichero lo dice todo: `cv-<nombre>[-<especialidad>][-<oferta>].md`.

## 4. Mira por qué

```bash tutorial
cv generate-cv -f ofertas/acme-backend.txt -s backend --top-n 2 --explain --stdout > /dev/null
```

Con `--top-n 2`, dentro de cada experiencia sobreviven los dos logros con más puntuación; los que no puntúan (sin etiquetas que coincidan con la oferta) van detrás y son los primeros en caer. Lo anclado con `#pin` nunca se recorta.

## 5. Lo mismo desde un PDF o desde el portapapeles

```bash
cv analyze-offer ofertas/acme-backend.pdf -s backend      # el texto se extrae en un proceso aislado, con límites
cv generate-cv -f - --compact < oferta.txt                # oferta por la entrada estándar
```

## Siguiente

[Tu propio tema](./own-theme): el mismo contenido, con la maquetación que tú decidas.
