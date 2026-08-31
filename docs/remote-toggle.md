# Conmutador de remotos en Ajustes (T-8.17) — PROPUESTA v1

Estado: BORRADOR para el PO · Encargo del Director del 31-ago («habilitar/deshabilitar remotos desde ajustes co-piloto»)

## §1 El problema

Hoy `--allow-remote` es una bandera de ARRANQUE de `cv serve` (frontera C3: sin ella, el proceso no puede hablar con
remotos, punto). Ajustes solo lo muestra. El Director quiere gobernarlo desde la web.

## §2 Opciones

- **A (recomendada): persistencia + reinicio explícito.** Nueva clave `[serve] allow_remote = true|false` en
  `cv.toml`, leída SOLO al arrancar (la bandera CLI la pisa). Ajustes gana un conmutador que escribe la clave (con
  la huella If-Match, como el resto) y muestra «se aplica al reiniciar el servidor», con el botón de apagar al lado.
  La frontera C3 queda intacta: un proceso arrancado sin remotos sigue siendo incapaz de hablar con ellos.
- **B: conmutación en caliente.** `POST /config/serve/remote {allowed}` con doble confirmación. Más cómodo y más
  peligroso: el proceso pasaría a poder habilitarse a sí mismo la red por una llamada HTTP local (cualquier página
  con el token podría), y C3 se degrada de propiedad del proceso a propiedad de un flag mutable.

## §3 Propuesta

Opción A. Piezas: clave en `ServeSettingsSchema` (nueva tabla `[serve]`), lectura en el arranque, PUT de Ajustes
reutilizando el flujo de `[llm]`, conmutador con el aviso de reinicio, y pruebas (arranque con y sin clave, la CLI
pisa, el PUT respeta huella). Sin cambios en el modelo de consentimientos por trabajo.

## §4 Decisiones que se piden al PO

1. **D1** Opción A (persistencia + reinicio) y descartar B por C3.
2. **D2** La bandera CLI `--allow-remote`/`--no-allow-remote` siempre gana sobre `cv.toml`.
3. **D3** Destino: 1.10.0.
