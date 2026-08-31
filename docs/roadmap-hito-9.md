# Hito 9 — Precisión, guardas y alcance (PROPUESTA v1)

Estado: BORRADOR para el PO · Encargo del PO del 31-ago-2026 tras cerrar el Hito 8 con la v1.11.0

## §1 De dónde sale este plan

No es una lista de deseos: cada tarea nace de algo medido hoy o de una deuda ya registrada en el ROADMAP.

| Evidencia | Medida | Tarea |
| --- | --- | --- |
| El nombre del CV importado sale mal | **1 de 11** PDF del corpus lo reconocen bien (`johndoe-wikimedia`); los demás toman un título de página («Chronological», «EXAMPLE RESUME», «SAMPLE RESUMES») | T-9.1 |
| Un defecto visual llegó a publicarse | La pantalla de importación usaba la clase `cv-pre`, **inexistente** en `app.css`: ni `tsc`, ni `svelte-check`, ni 176 pruebas de GUI lo vieron; lo cazó mirar la pantalla | T-9.2 |
| Sin segunda puerta estática | El proyecto no tiene lint: `npm run lint` no existe (deuda **B-6**, registrada el 29-ago) | T-9.3 |
| El ejecutable pesa 75 MB (tar.gz 49,5 MB) | Deuda **B-7**: comprobar si `strip` conserva el blob SEA y cuánto ahorra | T-9.4 |
| El co-piloto propone, pero mover las líneas es manual | T-8.18 deja las propuestas en el informe; aplicarlas sigue siendo copiar y pegar | T-9.5 |
| Solo publicamos `linux-x64` | Las imágenes ya son multi-arch, pero el tar.gz no; macOS y Windows exigen firma (**T-6.5**) | T-9.6 |
| Portal solo en español | **T-7.1b**, registrada por el Director el 29-ago | T-9.7 |

## §2 Las tareas

- **T-9.1 [IMPORT] El nombre y la cabecera, bien reconocidos.** Hoy la primera línea del PDF se toma como nombre.
  Propuesta: puntuar las primeras líneas (2–4 palabras capitalizadas, sin verbos ni palabras de plantilla —«resume»,
  «curriculum», «sample», «chronological»…—, con el contacto cerca) y elegir la mejor, no la primera; si ninguna
  puntúa, dejar «Nombre pendiente» **con aviso** en vez de inventar. Se mide sobre los 11 PDF del corpus antes y
  después, y el nombre del borrador (`import/<nombre>/`) deja de heredar un título de página.
- **T-9.2 [QA] Guarda de clases de estilo en la interfaz.** Una prueba que recorre los `.svelte` y falla si una clase
  `cv-*` usada no existe en `app.css` (y, al revés, avisa de las definidas que ya no usa nadie). Es la puerta que
  habría detenido el defecto de hoy, y cuesta una prueba.
- **T-9.3 [QA] ESLint como segunda puerta estática (B-6).** `typescript-eslint` con un juego corto de reglas que
  `tsc` no cubre (promesas sin esperar, `any` implícitos en callbacks, importaciones sin usar), integrado en CI.
- **T-9.4 [RELEASE] `strip` del ejecutable SEA (B-7).** Medir tamaño y humo con y sin `strip`; si el blob sobrevive,
  adoptarlo en `package.ts` y en la imagen.
- **T-9.5 [IMPORT/GUI] Aplicar una propuesta del co-piloto.** Botón por propuesta que **mueve** esa línea a la
  sección propuesta del borrador, con confirmación explícita y registro en el informe. Sigue decidiendo la persona
  (C2): el modelo no aplica nada, el botón sí, y solo lo que se le pide.
- **T-9.6 [RELEASE] `linux-arm64` en la release.** El tar.gz para arm64 no necesita firma; macOS y Windows quedan
  supeditados a T-6.5 (firma y notarización), que exige cuentas de desarrollador del Director.
- **T-9.7 [DOCS] Portal en inglés (T-7.1b).** Segundo `locale` de VitePress con la guía y la referencia.

## §3 Orden y versiones que propongo

1. **v1.12.0**: T-9.1 (precisión de la importación) + T-9.2 (guarda de clases). Lo que más se nota y lo que evita
   repetir el fallo de hoy.
2. **v1.13.0**: T-9.3 (ESLint) + T-9.4 (`strip`). Deuda registrada, coste acotado.
3. **v1.14.0**: T-9.5 (aplicar propuestas) y T-9.6 (arm64).
4. Sin fecha: T-9.7 (portal en inglés) y T-6.5 (firma), que depende del Director.

## §4 Decisiones que se piden al PO

1. **D1** El alcance del §2 tal cual, o los cambios que prefiera (quitar, añadir, reordenar).
2. **D2** El reparto por versiones del §3.
3. **D3** T-9.5: ¿le parece bien que un botón **mueva** una línea del informe al borrador con confirmación, o
   prefiere que el borrador solo se toque a mano y el co-piloto se quede en proponer?
