# Proveedor remoto Gemini (Google) — PROPUESTA v1 (T-8.15)

Estado: BORRADOR para el PO · Orden del Director del 2026-08-30 («quiero que añadas la posibilidad de proveedor externo gemini») · Luz verde de principio del PO el 2026-08-30, pendiente de aprobación final

## §0 Encargo y contexto

El spike de proveedores (T-8.2, `docs/copilot-providers.md` §1 y §9) descartó a Gemini como **defecto** porque su
plan gratuito usa el contenido para mejorar los productos de Google. El Director lo pide ahora como **proveedor
explícito**: elegido orden a orden con `--provider gemini` (canon C3), nunca por configuración silenciosa, y con el
aviso de datos delante del usuario. Con ese consentimiento informado, encaja en el canon.

## §1 Evidencia técnica (leída el 2026-08-30)

- **API compatible con OpenAI** (`ai.google.dev/gemini-api/docs/openai`): base
  `https://generativelanguage.googleapis.com/v1beta/openai/`; rutas `…/openai/chat/completions` y `…/openai/models`
  — **sin el segmento `/v1` que nuestro cliente añade** (`${baseUrl}/v1/chat/completions`). *Structured outputs*
  (`response_format` con esquema) documentado con Pydantic y Zod.
- **Cuotas** (`ai.google.dev/gemini-api/docs/rate-limits`, «Last updated 2026-08-18 UTC»): la página **no publica**
  RPM/TPM/RPD por modelo ni nivel («view your active rate limits in AI Studio») y **no documenta cabeceras** de
  cuota → en el registro: `quota: undefined` (solo la fuente) y `rateLimitHeaders: []`.
- **Clave**: `GEMINI_API_KEY` en su documentación → nuestra `CHAMELEON_GEMINI_API_KEY` (y el fichero de claves 0600).
- **Datos**: el plan gratuito usa las peticiones para mejorar productos (evidencia del spike, §1 de
  copilot-providers). El de pago (Cloud Billing) no; no distinguimos el plan desde fuera → **el aviso se muestra siempre**.

## §2 Propuesta

1. **Registro** (`src/llm/registry.ts`): entrada `gemini`, `api: 'openai-chat'`, host
   `generativelanguage.googleapis.com`, `baseUrl https://generativelanguage.googleapis.com/v1beta/openai`,
   **campo nuevo opcional `paths`** (`{ chat?: string; models?: string }`, por defecto `/v1/chat/completions` y
   `/v1/models`) que el cliente compatible respeta — cambio aditivo que no toca a openai/groq.
2. **Modelos**: `gemini-2.5-flash` (por defecto; rápido y barato) y `gemini-2.5-pro` (seleccionable). Sin
   `recommendedFor` hasta pasar el arnés de IA en español (como con Groq/DeepSeek: sin evaluación no hay recomendación).
3. **Aviso de datos**: en `cv llm status`, en el selector del Co-piloto y en el consentimiento remoto:
   «Gemini (plan gratuito) usa las peticiones para mejorar los productos de Google; no envíes lo que no quieras
   compartir». Documentado en la guía del co-piloto y en copilot-providers §11.
4. **Verificación al alta (protocolo §9, reproducible por una persona)**: el Director ya dispone de una
   `GEMINI_API_KEY` en esta máquina → `cv llm key set gemini` (sin eco), `cv llm status --provider gemini`
   (lista modelos por `…/openai/models`), y `cv improve --provider gemini -n 1 --yes` sobre una copia del banco
   (nunca datos reales). El resultado se anota en copilot-providers §11; hasta entonces
   `availability: 'pending-verification'` (rechazado por `--provider`, la API y el selector).
5. **Pruebas**: registro (paths por proveedor, defaults intactos), cliente compatible con `paths` (dobles),
   claves, status con el aviso, GUI Ajustes (tarjeta del proveedor con aviso); 100 % como siempre.

## §3 Fuera de alcance

La API nativa de Gemini (`generateContent`), *grounding*, ficheros; cualquier selección automática de remoto.

## §3.5 Estado

**IMPLEMENTADO el 31-ago-2026 (tras la 1.9.0)**: entrada `gemini` en el registro (`pending-verification`, rutas
propias `paths.chat`/`paths.models` sin `/v1`, `dataNote` permanente, modelos sin `recommendedFor` por D3), el
cliente compatible acepta rutas por proveedor, el aviso de datos viaja en `cv llm status`, en la ficha de Ajustes y
en el 409 de consentimiento de los trabajos (`dataNote` en los detalles, pintado en el diálogo del Co-piloto), y la
lista blanca y las variables de clave crecen solas desde el registro. **VERIFICADO Y ACTIVADO el 31-ago-2026**
con la clave del PO y solo con el banco de pruebas: el registro completo, con los tres defectos que la verificación
destapó (prefijo `models/`, `seed` rechazado y `gemini-2.5-flash` retirado para cuentas nuevas), está en
`docs/copilot-providers.md` §11.

## §4 Decisiones que se piden al PO

1. **D1** Alta de `gemini` como remoto explícito con el aviso de datos permanente.
2. **D2** Campo `paths` opcional por proveedor en el registro (aditivo).
3. **D3** `gemini-2.5-flash` por defecto y `gemini-2.5-pro` seleccionable, sin `recommendedFor` hasta evaluarlos.
4. **D4** `pending-verification` hasta completar el protocolo §9 con la clave del Director; la activación
   (`available`) será un cambio de datos en una versión menor.
5. **D5** Destino: 1.9.0 (junto a T-8.4b y T-8.5 S2/S3).
