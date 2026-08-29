---
title: Tutoriales
---
# Tutoriales

Cinco recorridos guiados, de principio a fin, sobre un espacio de trabajo real. Cada uno empieza en un directorio vacío y no necesita nada que no traiga `cv`, salvo donde se indica (Typst para los PDF de calidad editorial; un modelo local para el co-piloto).

| Tutorial | Aprenderás | Necesita |
|---|---|---|
| [1 · Tu perfil desde cero](./profile-from-scratch) | La forma de cada fichero, cómo validar, compilar y generar el primer CV en Markdown y PDF, y cómo leer `--explain`. | Nada |
| [2 · Un CV para tres ofertas](./three-offers) | Analizar tres ofertas distintas, afinar el CV a cada una, recortarlo y entender la puntuación. | Nada |
| [3 · Tu propio tema](./own-theme) | Crear un tema a partir de `classic`, cambiar sus variables, fijarlo en `cv.toml` y generar PDF con Typst. | `cv typst install` |
| [4 · El co-piloto con Ollama](./copilot-ollama) | Configurar un modelo local, ver exactamente qué saldría, obtener reescrituras y resúmenes verificados, etiquetar y aplicar lo que marques. | Ollama con un modelo |
| [5 · Todo en un contenedor](./docker) | Usar Chameleon CV con Docker Compose: tus datos en `my-profile`, PDF con Typst sin instalar nada, y la superposición de IA con Ollama. | Docker |
| [6 · La API desde la terminal](./api) | Arrancar `cv serve`, usarlo con `curl` (estado, fuentes, generación, trabajos del co-piloto con eventos en directo y revisiones) y pararlo: todo lo que necesita un cliente. | `curl`; un modelo local para el trabajo real |

::: tip Los tutoriales se ejecutan solos
Los bloques de órdenes marcados como tutorial se ejecutan en la integración continua contra el binario real, en un espacio de trabajo temporal, y se comprueba que producen los ficheros que cada página promete. Los pasos que requieren Typst, un modelo o Docker se omiten de forma visible cuando no están disponibles. Si un tutorial deja de funcionar, la CI lo detecta.
:::
