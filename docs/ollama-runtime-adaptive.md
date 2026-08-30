# Runtime de Ollama adaptativo: binario si lo hay, Docker si no, y respaldo al fallar (T-8.14) — PROPUESTA v1

Estado: PROPUESTA (2026-08-30) · Encargo del Director · Pendiente de aprobación del PO

## §0 Encargo

Director, 2026-08-30: «en copilot ajustes podemos arrancar/parar ollama, quiero que detecte si dispone de binario y si no
pruebe con docker para que se adapte a todos los entornos».

## §1 Qué hay hoy (T-8.8)

- `detect()` elige `native` si existe el binario `ollama` y, si no, `docker` si el demonio responde; sin ninguno, error.
- La elección es **rígida** en tres casos: (1) una preferencia `[llm.runtime] runner = "native"` (o `CHAMELEON_LLM_RUNNER`)
  falla con «no se encontró el binario» en vez de caer a Docker; (2) si el runner elegido **falla al arrancar** (el binario
  no responde, el contenedor no levanta) no se prueba la otra vía; (3) Ajustes y `cv llm status` dicen «runner native
  disponible» pero no explican qué se descarta ni por qué, y el consentimiento de descarga no dice con qué se arranca.

## §2 Propuesta

1. **Candidatos con motivo**: el estado del runtime expone `candidates: { native: { available, reason }, docker: { available,
   reason } }` y `plan: { runner, note }` (qué se usará y por qué: «binario ollama en PATH», «Docker 27.x; sin binario
   ollama», «preferencia native no disponible: …; se usa docker»). `cv llm status` y `GET /api/v1/llm/runtime` lo muestran.
2. **Preferencias, no órdenes**: `[llm.runtime] runner` y `CHAMELEON_LLM_RUNNER` expresan preferencia; si ese runner no está
   disponible se usa el otro con una línea de aviso. La opción explícita de la orden (`cv llm up --runner`, `runner` en
   `POST /llm/runtime`) sigue siendo estricta: quien la escribe sabe lo que pide.
3. **Respaldo al fallar el arranque**: si `ollama serve` no arranca o no responde a tiempo, y Docker está disponible, se
   intenta el contenedor (y a la inversa) con las líneas de progreso correspondientes; si ambos fallan, el error lista
   los dos motivos. Se limpia lo que dejó el intento fallido (pid) antes de probar el otro.
4. **Ajustes**: el panel «Ollama local» dice con qué arrancará («Se usará el binario ollama» / «Se usará Docker (contenedor
   chameleon-ollama): no hay binario ollama») y el consentimiento de descarga repite la vía; sin ninguna vía, el panel
   explica cómo instalar Ollama o Docker con el enlace de la guía.
5. Sin cambios en lo que se para: solo lo que arrancó cv (T-8.8).

## §3 Fuera de alcance

Podman y otros runtimes; instalar Ollama o Docker por el usuario; GPU.

## §4 Pruebas

`runtime.test.ts` (respaldo native→docker y docker→native al fallar el arranque, preferencia no disponible con aviso, opción
explícita no disponible = error, ambos fallan = error con los dos motivos, candidatos en el estado), rutas y CLI (nuevas
líneas), GUI (`describeRuntime` con la vía y el motivo; consentimiento), arnés `llm-runtime` (preferencia native con el
binario ausente y sin Docker → error con ambos motivos) y goldens; verificación manual en esta máquina (binario ausente →
Docker real).

## §5 Decisiones que se piden al PO

1. **D1** Candidatos con motivo en estado, CLI y API.
2. **D2** `[llm.runtime] runner` y `CHAMELEON_LLM_RUNNER` como preferencias con respaldo; `--runner`/`runner` explícitos, estrictos.
3. **D3** Respaldo automático al fallar el arranque, en ambos sentidos.
4. **D4** Ajustes muestra la vía y el motivo; consentimiento con la vía.
5. **D5** Versión 1.8.1 (corrección de adaptación al entorno).
