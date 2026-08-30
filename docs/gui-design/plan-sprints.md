# Plan de implementación por sprints

Reparto propuesto en §10 del brief, con lo que entra en cada sprint, las pruebas que lo cierran y el
criterio de aceptación. Cada sprint deja la aplicación funcionando: el rediseño se aplica pantalla a
pantalla sobre las clases nuevas, no en un *big bang*.

## S1 · Sistema visual, barra lateral y cabecera de contexto

**Entra**

- `gui/src/app.css`: sustituir el bloque de tokens por `tokens.css` y añadir `componentes.css`
  (las clases antiguas que ya no se usan se borran al migrar cada pantalla, no antes).
- Nuevo `gui/src/components/Nav.svelte` (barra lateral de tres grupos + Portal fuera de la app):
  ítems con icono, `aria-current="page"`, contador en Revisiones, plegado a iconos con persistencia
  en `localStorage` (`cv.nav.collapsed`) y forzado por debajo de 1024 px.
- Nuevo `gui/src/components/ContextHeader.svelte`: espacio de trabajo + ruta, chips de estado,
  conmutador de tema (claro / oscuro / sistema, `data-theme` en `<html>` aplicado antes del primer
  render para no destellar) y botón de apagar.
- `status` a un store compartido: una sola consulta alimenta los chips en todas las pantallas.
- `gui/src/App.svelte`: armazón `grid-template-columns: 232px 1fr` + `main` con scroll propio.
- Componentes base como piezas reutilizables: `Button`, `Chip`, `Badge`, `Card`, `Notice`, `Collapse`,
  `Meter`, `EmptyState`, `Skeleton`, `Dialog` (foco atrapado, `Esc`, foco inicial seguro), `Toast`,
  `Segmented`, `Tabs`, iconos en `gui/src/components/icons/`.

**Pruebas**

- Vitest: el conmutador de tema escribe `data-theme` y lo recupera de `localStorage`; el plegado persiste;
  `Nav` marca `aria-current` según la ruta; `Dialog` atrapa el foco y cierra con `Esc`.
- Playwright: recorrido completo con teclado (`Tab` → todos los ítems y controles, foco siempre visible);
  contraste AA automatizado en claro y oscuro; el conmutador de tema y «Apagar» **no** se recortan a 1024 px.
- Tamaño: comprobar el presupuesto ≤ 30 KB gzip del paquete inicial (el editor va en su chunk).

**Aceptación:** con la app en cualquier pantalla se sabe, sin navegar, si el artefacto está al día, si Typst
está, si el co-piloto responde y si el servidor permite remotos.

## S2 · Estado, Fuentes, Generar, Salidas

**Entra**

- `Estado.svelte`: cuatro tarjetas de la nueva rejilla; incidencias como lista `fichero:línea` enlazada a
  Fuentes; vacío con `cv init`; cargando con esqueletos de la misma altura que el éxito; error que dice que
  nada se ha modificado.
- `Fuentes.svelte`: árbol con badges de incidencias y filtro; barra con ruta, huella y Guardar deshabilitado
  sin cambios; marco del editor (canal de líneas, pie de estado); diálogo de conflicto con las dos huellas.
- `Generar.svelte`: **reescritura del formulario** de rejilla de cinco columnas a tres pasos; cuatro orígenes
  de oferta en pestañas (la URL pasa por consentimiento); panel de adecuación con barra de porcentaje y tres
  columnas con evidencias; informe de decisiones plegado con resumen de una línea; visor de PDF enmarcado;
  plegable de temas con Crear e Instalar.
- `Salidas.svelte`: tabla compacta (tipo, tamaño, fecha) + visor + descarga; vacío que lleva a Generar.

**Pruebas**

- Vitest: `buildGenerateRequest` con la forma nueva del formulario; `reportSections` produce el resumen de
  una línea; `analysisView` reparte en las tres columnas; el conflicto no guarda nada.
- Playwright: **Estado → Generar → PDF en ≤ 3 clics** con la especialidad y el tema visibles; cada estado
  (vacío, cargando, error, consentimiento) se renderiza; capturas regeneradas para la guía.

**Aceptación:** un usuario nuevo genera su primer PDF sin abrir la documentación.

## S3 · Co-piloto, Revisiones, Ajustes

**Entra**

- `Copiloto.svelte`: selector de tarea con descripción, límites, proveedor (local por defecto; remotos solo
  con clave), panel «qué sale y a dónde», lista de trabajos con progreso y enlace a la revisión, diálogo de
  consentimiento remoto con host, límite y **coste estimado**.
- `Revisiones.svelte`: ítem a ítem con `fichero:línea`, propuestas con casilla, rechazadas por C2 tachadas
  **con el motivo literal**, plan de aplicación y Aplicar con copia `.bak`.
- `Ajustes.svelte`: proveedor local (campos fijados por el entorno deshabilitados y etiquetados), remotos con
  clave/plan/cuota publicada y viva/modelos con tarea recomendada y estado, fichero de claves, lista blanca.
- Diálogo de sesión caducada (diseño pendiente, ver README §Pendiente).

**Pruebas**

- Vitest: `toggleMark`/`countMarks` sobre el texto de la revisión; una propuesta rechazada no se puede marcar;
  `describeProvider` y la cuota viva; los campos bloqueados no se envían al guardar.
- Playwright: lanzar un trabajo con proveedor remoto exige pasar por el diálogo (cancelar no envía nada);
  aplicar una revisión muestra el plan antes de escribir y deja `.bak`.

**Aceptación:** nada sale de la máquina ni se escribe en las fuentes sin un diálogo que diga qué, a dónde y
a qué coste.

## S4 · Portal

**Entra**

- `website/.vitepress/theme/custom.css`: mapear los tokens `--vp-c-*` a la paleta (valores en `pantallas.md` §8),
  quitar la fuente descargada del tema por defecto y fijar `system-ui`.
- Portada (`website/src/index.md` con `layout: home` + componentes Vue propios): hero con «qué es», bloque
  **«qué hace / qué no hace»**, tres caminos (binario, Docker, galería) y galería de temas.
- Páginas interiores: bloques destacados, pestañas de comando, `pre` con `✓`, navegación anterior/siguiente.
- Capturas reales de la app nueva generadas con `gui/e2e/screenshots.spec.ts` y publicadas en
  `website/src/public/gui/`.

**Pruebas**

- Playwright sobre el sitio construido: la portada responde «qué es y qué no hace» sin desplazarse en un
  portátil de 13″; modo oscuro con contraste AA; ningún recurso externo en las peticiones de red.

**Aceptación:** portada que se entiende en 10 segundos, coherente con la app, sin dependencias nuevas.

## Orden de trabajo dentro de cada pantalla

1. Marcado y clases (`componentes.css`) con datos reales del cliente de API existente.
2. Estados en este orden: **éxito → vacío → error → cargando → consentimiento**. El vacío antes que el
   cargando: orienta al usuario nuevo, que es el objetivo medible.
3. Teclado y `aria-*`.
4. Pruebas y captura para la guía.
