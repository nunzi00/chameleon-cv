---
title: Pruebas
---
# Pruebas

Tres niveles, con un principio común: la prueba debe probarse a sí misma (canon C13) y, cuando el sistema no es determinista, se valida el proceso y no el resultado (C12).

## Unitarias e integración (Vitest)

```bash
npm test                 # suite
npm run coverage         # con cobertura: umbral 100 % en toda la lógica de src/ (sentencias, ramas, funciones, líneas)
npm run test:watch
```

- Cada módulo se prueba con sus dependencias inyectadas: sistema de ficheros en memoria, proveedores de modelos falsos, renderer de Typst sustituido. Nada toca el disco real ni la red salvo las pruebas marcadas como reales.
- **Pruebas con el binario real de Typst**: se ejecutan cuando `CHAMELEON_TYPST` apunta a un Typst 0.15.1 (`cv typst install` y `export CHAMELEON_TYPST=~/.cache/chameleon-cv/typst/0.15.1/typst`); sin él se omiten. Comprueban, entre otras cosas, que los temas distribuidos conservan exactamente las palabras del texto extraído.
- El umbral del 100 % rompe la ejecución si baja: una rama nueva sin prueba no pasa la CI.

## Aceptación determinista

```bash
npm run build && npm run test:acceptance:deterministic            # 8 escenarios, 77 pasos, byte a byte
npm run test:acceptance:deterministic -- --require-typst            # los casos de Typst son obligatorios (CI)
npm run test:acceptance:deterministic -- --binary build/sea/cv      # contra el ejecutable empaquetado
npm run acceptance:update                                           # regenera los artefactos esperados (acto deliberado, revisado en el diff)
```

Ejecuta el binario compilado (proceso hijo real) sobre una copia temporal del banco de pruebas —una persona sintética con cuatro especialidades, ofertas en texto y PDF, un tema propio, `cv.toml` y revisiones marcadas— y exige coincidencia perfecta con 260 artefactos esperados versionados: Markdown, JSON y PDF (ambos motores son deterministas). Ante una discrepancia en PDF muestra además el diff del texto extraído. Los casos de Typst se omiten de forma **visible** si no hay binario. Autocomprobaciones: los generadores del banco reproducen sus ficheros, `dist/` está al día con `src/` y ningún artefacto esperado queda ignorado por git.

## Aceptación de IA

```bash
npm run test:acceptance:ai        # necesita Ollama (o compatible) con el modelo configurado; nunca usa un remoto
```

Precondición programática (el modelo responde), ejecución real de `improve`, `summarize` y `suggest tags` sobre una copia del banco y dieciséis comprobaciones del **proceso**: las órdenes terminan bien, las revisiones cumplen el formato, toda propuesta aceptada vuelve a superar el verificador ejecutado de forma independiente, las etiquetas pertenecen al diccionario cerrado, nada de PII sale hacia el modelo y `data/sources` queda intacto. No se juzga el texto del modelo. Es manual (o nocturna): la CI no tiene modelo.

## Documentación

```bash
npm run docs:check                # referencia generada + sincronización + build sin enlaces muertos + tutoriales ejecutados
```

La referencia de comandos se genera desde la ayuda de la CLI y los tutoriales son guiones que se ejecutan contra el binario en un espacio temporal, comprobando los ficheros que prometen. Detalle: [Documentación (Docs-as-Code)](/developers/docs).

## En la integración continua

`ci.yml` ejecuta en cada push y pull request: typecheck, build, Typst instalado con `cv typst install` (cacheado), cobertura al 100 % con Typst real y el arnés determinista con Typst obligatorio. El release repite lo mismo y, además, acepta el ejecutable empaquetado con el arnés antes de publicarlo. Guía completa: [Pruebas de aceptación](/design/acceptance-testing).
