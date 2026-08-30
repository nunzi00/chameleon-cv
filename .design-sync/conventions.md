# Chameleon CV · convenciones para diseñar con este sistema

Este sistema de diseño describe la interfaz web local de **Chameleon CV** (una app Svelte servida por `cv serve` y un portal VitePress). No trae componentes React: diseña con componentes genéricos, pero **con estos tokens, esta tipografía y este vocabulario de clases**, y sigue `guidelines/brief.md` (objetivos, principios, arquitectura de información, pantallas y estados, restricciones).

## Tokens (styles.css → `:root`, con variante oscura)

Usa siempre `var(--cv-*)`; no inventes colores ni tamaños. Claro: `--cv-bg: #f6f7f9`, `--cv-surface: #ffffff`, `--cv-text: #1b1b1b`, `--cv-muted: #5b6470`, `--cv-border: #d8dde3`, `--cv-accent: #1f4e79`, `--cv-accent-text: #ffffff`, `--cv-ok: #1f7a3a`, `--cv-warn: #9a6700`, `--cv-error: #b42318`, `--cv-error-bg: #fdeceb`, `--cv-radius: 0.5rem`, `--cv-space: 1rem`, `--cv-font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`, `--cv-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. Oscuro (media query `prefers-color-scheme: dark`): `--cv-bg: #121418`, `--cv-surface: #1b1f26`, `--cv-text: #e6e8eb`, `--cv-muted: #a0a8b3`, `--cv-border: #2f3540`, `--cv-accent: #6ea8d8`, `--cv-accent-text: #0e1a26`, `--cv-error-bg: #3a1f1d`.

## Tipografía y espaciado

`--cv-font` (system-ui) para la interfaz, `--cv-mono` solo para rutas, comandos y texto literal; radio `--cv-radius` (0,5 rem) y unidad de espaciado `--cv-space` (1 rem); rejilla de 8 px; cuerpo ≥ 14 px; contraste AA en claro y oscuro.

## Vocabulario de clases existente (styles.css)

`.cv-actions`, `.cv-app`, `.cv-badge`, `.cv-button`, `.cv-card`, `.cv-check`, `.cv-compare`, `.cv-editor`, `.cv-field`, `.cv-form`, `.cv-gate`, `.cv-grid`, `.cv-issues`, `.cv-job`, `.cv-jobs`, `.cv-kv`, `.cv-main`, `.cv-muted`, `.cv-nav`, `.cv-notice`, `.cv-pdf`, `.cv-plan`, `.cv-proposal`, `.cv-report`, `.cv-review-item`, `.cv-split`, `.cv-sr-only`, `.cv-tag`, `.cv-tag-remove`, `.cv-tags`, `.cv-tags-group`, `.cv-tags-label`, `.cv-tree`. Son los patrones actuales (barra superior `.cv-nav`, tarjetas `.cv-card`, formularios `.cv-form`/`.cv-field`/`.cv-check`, botones `.cv-button` (variante `.primary`), avisos `.cv-notice`, etiquetas `.cv-badge`, selector de etiquetas `.cv-tags`/`.cv-tag`, árbol `.cv-tree`, editor `.cv-editor`, trabajos `.cv-jobs`/`.cv-job`, revisiones `.cv-review-item`/`.cv-proposal`/`.cv-compare`/`.cv-plan`, informes `.cv-report`). Un diseño nuevo puede sustituirlos, pero lo que entregues debe poder expresarse con clases y tokens CSS (Svelte 5 + CSS propio, sin Tailwind ni bibliotecas de componentes, sin fuentes externas: CSP `font-src 'self'`).

## Dónde está la verdad

`styles.css` (tokens y clases reales), `tokens/tokens.json` (los mismos tokens en JSON), `guidelines/brief.md` (el brief completo con las siete pantallas, sus estados y los entregables esperados: HTML/CSS o JSX por pantalla y una hoja de tokens).

## Ejemplo idiomático

```html
<section class="cv-card">
  <h2>Generar</h2>
  <form class="cv-form">
    <label class="cv-field"><span>Especialidad</span><select name="specialty"><option>backend</option></select></label>
    <div class="cv-actions"><button class="cv-button primary" type="submit">Generar CV</button><button class="cv-button" type="button">Analizar oferta</button></div>
  </form>
  <div class="cv-notice warn">Esta oferta ya se procesó una vez: 2026-08-30 12:10 · Generar CV (backend) → output/cv.pdf</div>
</section>
```
