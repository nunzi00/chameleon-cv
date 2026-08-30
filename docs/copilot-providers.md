# Proveedores externos con plan gratuito: informe del *spike* (T-8.2, S1)

| | |
|---|---|
| **Tarea** | T-8.2 · S1 · *spike* de proveedores (decisión 3 de `docs/copilot-settings.md` §10) |
| **Estado** | Evidencia recogida el 2026-08-30; **decisión del Director de Ingeniería y Producto el 2026-08-30: integrar solo Groq** (§9); verificación al alta pendiente de una cuenta humana (§9) |
| **Método** | Lectura de los documentos oficiales vigentes (política de privacidad, condiciones del servicio o de la API, páginas de datos y de límites) mediante peticiones GET públicas, sin registrarse en ningún servicio ni enviar datos. Cada afirmación lleva URL, fecha de acceso y cita literal en su idioma original. Cuando una página no se pudo leer, se dice. |
| **Criterios** (§4.3) | (a) C7: sin entrenamiento ni retención más allá de lo operativo, también en el plan gratuito; (b) plan gratuito sin tarjeta y con límites publicados; (c) API compatible con OpenAI; (d) HTTPS con host fijo; (e) salida JSON estructurada |

## 0. Resumen

- **Groq** es el único candidato que cumple hoy los cinco criterios: prohibición contractual de entrenar con entradas y salidas, retención máxima de 30 días solo para fiabilidad y abuso (desactivable con *Zero Data Retention*, disponible para todos los clientes), plan Free sin tarjeta (implícito), API `https://api.groq.com/openai/v1`, `json_schema` y `json_object`, y seis cabeceras de cuota documentadas más `retry-after`.
- **GitHub Models fue retirado el 30 de julio de 2026**: su API de inferencia ya no existe para ningún cliente. Descartado.
- **Cerebras** cumple C7 sobre el papel, pero **ya no tiene plan gratuito**: 5 $ de crédito que caducan a los 30 días y exigen un método de pago verificado; las cabeceras de cuota no están documentadas. Descartado por (b).
- **Google Gemini API** no cumple C7 en el plan gratuito: sus condiciones dicen que el contenido enviado a los servicios no de pago se usa para mejorar los productos y puede ser leído por revisores humanos. Descartado.
- **Mistral (Free mode)** no cumple C7 por defecto (uso para entrenamiento con *opt-in* por defecto en el plan gratuito, *opt-out* manual, retención de 30 días sin ZDR, que solo existe en planes de pago) y no publica sus límites. Descartado.
- **OpenRouter** (modelos `:free`) y **Together AI** quedan como reservas dudosas: OpenRouter no entrena pero delega en proveedores *upstream* que pueden hacerlo; Together declara no entrenar sin consentimiento, pero sus créditos gratuitos no aparecen en las páginas oficiales leídas y sus límites son dinámicos.
- **Recomendación del Director Técnico**: integrar **Groq** como primer proveedor externo gratuito (con ZDR recomendado en la guía) y **no integrar un segundo** por ahora: ninguno reúne evidencia suficiente. Se reevalúa cuando cambien las políticas (las fechas de esta tabla lo permiten).

## 1. Groq (GroqCloud)

**C7 — CUMPLE.** La Privacy Policy pública (https://groq.com/privacy-policy, versión del 12-11-2025) y los Terms of Use (https://groq.com/terms-of-use, 15-10-2025) excluyen expresamente GroqCloud; la API se rige por el *Groq Services Agreement* (https://console.groq.com/docs/legal/services-agreement, «Last Modified: June 22, 2026», acceso 2026-08-30):

> «Groq is not permitted to use Inputs or Outputs for training or fine-tuning any AI Model Services or other models, unless explicitly granted permission or instructed by Customer.»

*Your Data in GroqCloud* (https://console.groq.com/docs/your-data, acceso 2026-08-30):

> «inference requests are not retained by default. We may temporarily log inputs and outputs only when: […] These logs are retained for up to 30 days, unless legally required to retain longer.»

El mismo Agreement cubre los servicios «designated as fee-free or otherwise available without triggering a payment»; la página de datos no distingue planes y añade: «All customers may enable Zero Data Retention (ZDR) in Data Controls settings».

**Plan gratuito (b).** Existe («Free Plan», https://console.groq.com/docs/rate-limits). Tarjeta: no se exige de forma explícita; el FAQ de facturación (https://console.groq.com/docs/billing-faqs) solo pide un método de pago «To upgrade from the Free tier to the Developer tier» y permite volver a Free en cualquier momento. **Pendiente de contrastar al alta.** Límites publicados por organización (2026-08-30): `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `openai/gpt-oss-safeguard-20b`, `qwen/qwen3.6-27b`: 30 RPM · 1 000 RPD · 8 000 TPM · 200 000 TPD; `qwen/qwen3.8-27b`: 30 · 1 000 · 8 000 · 2 000 000; `groq/compound` y `compound-mini`: 30 RPM · 250 RPD · 70 000 TPM. Los modelos Llama de chat ya no figuran en el plan Free.

**API (c, d, e).** Compatible con OpenAI en `https://api.groq.com/openai/v1` (https://console.groq.com/docs/openai), `Authorization: Bearer`. Salida estructurada (https://console.groq.com/docs/structured-outputs): `json_schema` estricto en gpt-oss-20b/120b y qwen3.8-27b; `json_object` en todos los modelos; sin *streaming* ni herramientas con salida estructurada; sin `logprobs`, `logit_bias` ni `n > 1`.

**Cabeceras de cuota (d).** Documentadas en https://console.groq.com/docs/rate-limits: `retry-after` (segundos, solo con 429), `x-ratelimit-limit-requests` (por día), `x-ratelimit-limit-tokens` (por minuto), `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-requests` (p. ej. `2m59.56s`), `x-ratelimit-reset-tokens` (p. ej. `7.66s`). «The other headers are always included.»

**Otros.** Datos en GCP en Estados Unidos; edad mínima 18 años; jurisdicción de Inglaterra y Gales para EMEA. No se pudo leer trust.groq.com (solo JavaScript) ni los *Terms of Sale* (redirigen al índice).

**Implicación para el producto**: con 8 000 tokens por minuto, los prompts del co-piloto deben ser compactos (ya lo son: se envían fragmentos, no ficheros); el `QuotaLedger` (§4.4 de la propuesta) mostrará estas cabeceras tal cual.

## 2. GitHub Models — retirado

Changelog oficial https://github.blog/changelog/2026-07-30-github-models-is-now-retired/ (30-07-2026, acceso 2026-08-30): «As of July 30, 2026, GitHub Models is now retired.» «The playground, model catalog, inference API, and bring your own key (BYOK) are no longer available to any customer, including existing customers with active usage.» Aviso previo: https://github.blog/changelog/2026-07-01-github-models-is-being-fully-retired-on-july-30-2026/. Las páginas de documentación (https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models, https://docs.github.com/en/rest/models/inference) solo muestran el aviso; los *GitHub Terms for Additional Products* ya no contienen la sección «GitHub Models». **Veredicto: no aplica.**

## 3. Cerebras Inference

**C7 — CUMPLE (sobre el papel).** Terms of Service (https://www.cerebras.ai/terms-of-service, 27-08-2024): «For clarity, the foregoing does not grant Cerebras the right to use Service Content for the purpose of training or fine-tuning models.» Privacy Policy (https://www.cerebras.ai/privacy-policy, 27-08-2024): «We do not retain inputs and outputs associated with our training, inference and chatbot Services.» Documentos de 2024, anteriores al cambio de modelo comercial.

**Plan gratuito (b) — NO.** https://inference-docs.cerebras.ai/support/rate-limits (acceso 2026-08-30): «New accounts receive $5 in free credits after adding a verified payment method. These credits expire 30 days after they're granted»; «If you skip adding a payment method at sign-up, Playground and API access remain inactive until you do.»; «Is there a permanently free tier? No.» (La página de precios, https://www.cerebras.ai/pricing, aún habla de 5 $ sin mencionar la tarjeta; la documentación es más precisa.) Límites de la prueba: 5 RPM · 30 000 TPM · 1 000 000 TPD.

**API.** `https://api.cerebras.ai/v1/chat/completions`, `Bearer`, `json_object` y `json_schema` estricto. **Cabeceras de cuota: no documentadas oficialmente** (solo evidencia de terceros, mayo de 2025, con nombres que pueden haber cambiado). **Veredicto: descartado por (b) y (d).**

## 4. Google Gemini API

**C7 — NO CUMPLE (plan gratuito).** Gemini API Terms (https://ai.google.dev/gemini-api/terms, 28-04-2026, acceso 2026-08-30):

> «When you use Unpaid Services, including, for example, Google AI Studio and the unpaid quota on Gemini API, Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services.»

> «To help with quality and improve our products, human reviewers may read, annotate, and process your API input and output.»

Y: «Do not submit sensitive, confidential, or personal information to the Unpaid Services.» Solo la cuota de pago (proyecto con facturación) declara no usar los datos para mejorar productos; la página de precios (https://ai.google.dev/gemini-api/docs/pricing) lo marca por modelo («Used to improve our products — Free Tier: Yes / Paid Tier: No»).

**Plan gratuito.** Existe sin tarjeta, pero los **límites no se publican** (solo visibles tras iniciar sesión en AI Studio). API compatible con OpenAI en beta (`https://generativelanguage.googleapis.com/v1beta/openai/`); sin cabeceras `x-ratelimit-*` (el 429 lleva `retryDelay` en el cuerpo). **Veredicto: descartado por C7.**

## 5. Mistral (La Plateforme / Studio, Free mode)

**C7 — NO CUMPLE por defecto.** Centro de ayuda (https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models, acceso 2026-08-30): «Free mode — As stated during subscription, we may use your data (input and output) to train our artificial intelligence models.» y «Pay-as-you-go — Data used with pay-as-you-go (input and output) is not used to train our artificial intelligence models.» El artículo de *opt-out* confirma que solo el plan de pago está «opted out of training by default». Privacy Policy (https://legal.mistral.ai/terms/privacy-policy, 27-07-2026): retención de entradas y salidas «for thirty (30) rolling days to monitor abuse (unless zero data retention is activated)», y ZDR «available on paid plans». Incoherencia detectada: https://docs.mistral.ai/admin/monitor-comply/privacy-data-controls afirma que los datos de la API no se usan para entrenar, en contra del centro de ayuda y de la política; ante la duda, prevalece el documento legal.

**Plan gratuito.** «API access is enabled by default with no credit card required» (https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key), pero los **límites no se publican** (solo tras iniciar sesión) y el artículo del plan Experiment devuelve 404. Una sola cabecera documentada (`X-RateLimit-Remaining`). **Veredicto: descartado por C7 (y por (b) y (d)).**

## 6. Reservas: OpenRouter y Together AI

- **OpenRouter.** Privacy (https://openrouter.ai/privacy, 06-07-2026): «OpenRouter does not use your Inputs or Outputs for model training.» Pero: «Some Model Providers may use your Inputs and Outputs for model training or improvement.» Modelos `:free`: 20 RPM y 50 RPD sin tarjeta (https://openrouter.ai/docs/api-reference/limits); cabeceras `X-RateLimit-*` y `Retry-After`; API `https://openrouter.ai/api/v1`. **C7: DUDOSO** (depende del proveedor *upstream*; existe un ajuste de privacidad que excluye a los que entrenan, y puede dejar sin endpoints gratuitos).
- **Together AI.** Privacy (https://www.together.ai/privacy, 17-12-2025): «We do not use any data collected from you to train our models without your explicit opt-in and consent.» Créditos gratuitos **no confirmados** en las páginas oficiales; límites dinámicos sin tabla. **C7: CUMPLE; plan gratuito: DUDOSO.**

## 7. Tabla comparativa (acceso 2026-08-30)

| Proveedor | C7 | Plan gratuito y límites | Compatible con OpenAI | Salida JSON | Cabeceras de cuota |
|---|---|---|---|---|---|
| **Groq** | **CUMPLE** | Free Plan, sin tarjeta (implícito); 30 RPM · 1 000 RPD · 8 000 TPM · 200 000–2 000 000 TPD | Sí (`/openai/v1`) | `json_schema` (3 modelos) y `json_object` (todos) | 6 × `x-ratelimit-*` + `retry-after`, documentadas |
| GitHub Models | NO APLICA | Retirado el 30-07-2026 | — | — | — |
| Cerebras | CUMPLE | Sin plan gratuito (5 $ por 30 días, tarjeta obligatoria) | Sí | `json_schema` y `json_object` | No documentadas |
| Gemini | **NO CUMPLE** | Sí, sin tarjeta; límites solo tras iniciar sesión | Sí (beta) | `json_schema` (beta) | Ninguna |
| Mistral | NO CUMPLE (defecto) / DUDOSO (opt-out) | Free mode sin tarjeta; límites no publicados | Forma compatible | `json_object` y `json_schema` | Solo `X-RateLimit-Remaining` |
| OpenRouter | DUDOSO (upstream) | `:free` 20 RPM · 50 RPD, sin tarjeta | Sí | `json_schema` por endpoint | `X-RateLimit-*`, `Retry-After` |
| Together | CUMPLE | Créditos no confirmados; límites dinámicos | Sí | `json_schema` | `x-ratelimit-reset` |

## 8. Propuesta de decisión (para el Director)

1. **Integrar Groq** como proveedor `groq` del registro (`api: openai-chat`, host `api.groq.com`, URL `https://api.groq.com/openai/v1`, modelo por defecto `openai/gpt-oss-120b`, plan `free`, cuotas publicadas de la tabla con fuente y fecha, evidencia C7 con las dos citas), con una nota en la guía recomendando activar ZDR en su consola.
2. **No integrar un segundo proveedor** en T-8.2: OpenRouter y Together no alcanzan la evidencia exigida. Registrar aquí la fecha y volver a mirar en la siguiente revisión del registro.
3. **Verificar al alta** (sprint 2, cuenta del Director Técnico, solo datos del banco de pruebas): que el plan Free no exige tarjeta, que el arnés de IA pasa contra Groq con `json_object`/`json_schema` y que las cabeceras de cuota llegan como se documentan.

## 9. Decisión del Director (2026-08-30) y protocolo de verificación al alta

**Decisión**: integrar **Groq** como primer y único proveedor externo gratuito; ningún segundo proveedor sin garantía contractual clara y pública (la categoría «dudoso» no es aceptable); verificación al alta con una cuenta del Director Técnico y exclusivamente datos del banco de pruebas.

**Nota del Director Técnico**: la creación de cuentas en servicios de terceros queda fuera de lo que este asistente puede hacer por sí mismo; la cuenta la abre una persona. El protocolo, reproducible por quien la tenga (el Director de Ingeniería o el Director Técnico humano), es este:

1. Alta en console.groq.com en el plan Free **sin introducir ningún método de pago** y anotar si el alta lo exige (criterio (b) del §0: hoy no está escrito literalmente). Activar *Zero Data Retention* en Data Controls si la consola lo ofrece.
2. Guardar la clave sin que pase por el historial ni por argumentos: `cv llm key set groq` (pregunta sin eco) y comprobar `cv llm key list`.
3. Salud, modelos y cuota publicada, con una sola llamada y sin datos: `cv llm status --provider groq` (debe listar `openai/gpt-oss-120b` y no fallar).
4. Prueba funcional con el banco (nunca con datos reales): en una copia de `tests/acceptance/bench/workspace`, `cv build` y `cv improve --provider groq -n 1 --yes`; comprobar la revisión escrita y la línea final «Cuota según groq: …» (las cabeceras llegan como se documentan).
5. Anotar aquí la fecha, el resultado de cada paso y cualquier discrepancia con la evidencia de §1; si algo no cuadra (tarjeta obligatoria, salida JSON rechazada, cabeceras ausentes), Groq se retira del registro con un cambio de datos y una entrada en el CHANGELOG antes de la 1.5.0.
