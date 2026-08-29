# Contribuir a Chameleon CV

Gracias por tu interés. Este documento explica cómo montar el entorno, qué exige el proyecto a cada cambio y cómo proponer una *pull request*. La guía completa para desarrolladores (arquitectura, pruebas, extensión) está en el portal de documentación (`website/`, publicado en GitHub Pages) y en las notas de diseño de `docs/`.

## Antes de empezar

- `ROADMAP.md` es la única fuente de verdad sobre qué se está construyendo y por qué. Las notas de `docs/` recogen cada decisión de diseño y su estado.
- Los **cánones** del proyecto (C1–C15, en `docs/llm-integration.md` §3) no son decorativos: la IA sugiere y el usuario decide; sin invención; local por defecto; el proceso se valida, no el resultado; la prueba se prueba a sí misma; el núcleo es el producto. Un cambio que los contradiga no se acepta, por bueno que sea.
- Abre un *issue* antes de una funcionalidad grande: así acordamos el diseño antes del código.

## Entorno

```bash
git clone https://github.com/nunzi00/chameleon-cv.git && cd chameleon-cv
# Node.js: la versión de .node-version (26.x); npm 10 o superior
npm ci
npm run build
node dist/index.js typst install     # opcional pero recomendado: las pruebas con Typst real se omiten sin él
export CHAMELEON_TYPST=~/.cache/chameleon-cv/typst/0.15.1/typst
```

## Ciclo de trabajo

| Orden | Qué comprueba |
|---|---|
| `npm run typecheck` | TypeScript en modo estricto para `src/`, `tests/` y `scripts/`. |
| `npm test` · `npm run coverage` | Suite unitaria (Vitest). La cobertura de `src/` debe ser del **100 %** (sentencias, ramas, funciones y líneas): el umbral rompe la ejecución si baja. |
| `npm run test:acceptance:deterministic` | Arnés de aceptación: el binario compilado sobre el banco de pruebas, coincidencia byte a byte con los artefactos esperados (`--require-typst` para exigir los casos de Typst). |
| `npm run test:acceptance:ai` | Arnés de IA con un modelo local (Ollama o compatible): valida el proceso, no el texto. Manual. |
| `npm run docs:check` | Portal de documentación: referencia generada desde la CLI, sincronización, build sin enlaces muertos y tutoriales ejecutados. |
| `npm run package` | Ejecutable autónomo con prueba de humo y archivo reproducible (Node 26). |

Regenerar los artefactos esperados del banco de pruebas es un acto deliberado (`npm run acceptance:update`) que se revisa en el diff de la PR; nunca los toques a mano.

## Convenciones

- **Idioma**: castellano en código, mensajes, documentación y commits.
- **Commits atómicos** con la convención `tipo(ámbito): resumen (T-x.y)` —`feat`, `fix`, `docs`, `test`, `chore`, `ci`, `build`— y referencia a la tarea del ROADMAP cuando la haya.
- **Cobertura 100 %** de la lógica de `src/`: cada rama nueva lleva su prueba. Las pruebas no tocan el disco ni la red salvo las marcadas como reales (Typst) o de aceptación.
- **Sin dependencias nuevas sin justificación**: cada paquete amplía la cadena de suministro del binario. Versiones fijadas; Dependabot mantiene las actualizaciones.
- **Seguridad por diseño**: ninguna conexión de red nueva sin consentimiento explícito del usuario; nada de datos personales en registros, cachés sin permisos 0600 ni artefactos versionados; toda entrada pasa por un esquema estricto.
- **Documentación como código**: cada cambio de comportamiento actualiza la guía del portal (`website/src/`). La referencia de comandos se genera desde la ayuda de la CLI (no se edita a mano) y los tutoriales son guiones ejecutables que corren en CI: si tu cambio los rompe, actualízalos.

## Pull requests

1. Rama desde `main`; una PR por cambio coherente.
2. Antes de abrirla: `npm run typecheck && npm run coverage && npm run build && npm run test:acceptance:deterministic` (y `npm run docs:check` si tocas la documentación o la CLI).
3. Describe qué cambia, por qué y cómo se ha verificado; enlaza el *issue* o la tarea del ROADMAP.
4. La CI ejecuta lo mismo que el trabajo `verify` del release; una PR en rojo no se revisa.
5. Los cambios de diseño (formato de las fuentes, cánones, flujo de release) van acompañados de su nota en `docs/` o de la actualización de la existente.

## Seguridad

Si encuentras una vulnerabilidad, no abras un *issue* público: usa los avisos de seguridad privados del repositorio en GitHub (*Security → Report a vulnerability*).

## Licencia

Al contribuir aceptas que tu aportación se distribuya bajo la [licencia MIT](LICENSE) del proyecto.
