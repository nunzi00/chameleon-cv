# Generar con la adecuación de la oferta (T-8.9) — PROPUESTA v1

Estado: PROPUESTA (2026-08-30) · Encargo del Director · Pendiente de aprobación del PO

## §0 Encargo

Director, 2026-08-30: «cuando analizo una oferta, espero que al generar cv se utilicen los requisitos demostrados
además de que se utilice el perfil acorde a la oferta».

## §1 Qué pasa hoy

- Con oferta y **sin** especialidad, el CV se recorta con una especialidad virtual formada por las tags que la oferta
  evidencia (`offerSpecialty`), y la oferta puntúa y reordena. Con oferta **y** especialidad, la especialidad elige
  la versión y la oferta reordena. Es decir, «el perfil acorde a la oferta» ya existe, pero no se ve ni se elige.
- Los límites por cantidad (`--top-n`, `--compact`, `--max-skills`…) recortan por puntuación: una evidencia que
  demuestra un requisito puede quedar fuera si el límite es corto, y nada lo avisa.
- La pantalla Generar analiza y genera por separado: nada conecta «demostrados» con lo que sale en el CV.

## §2 Propuesta

1. **Especialidad sugerida.** El análisis calcula la especialidad real del perfil cuyas tags más pesan entre los
   requisitos reconocidos (`suggestedSpecialty`, con su cobertura; empate o sin especialidades → ninguna). Sale en
   `cv analyze-offer` («Especialidad sugerida: backend (cubre 5 de 8 requisitos)») y en `POST /analyze-offer`.
   En la GUI, si el paso 1 está vacío, se rellena con la sugerida y se dice.
2. **Evidencias conservadas.** Con oferta, los ítems que demuestran algún requisito (logros, skills, proyectos y
   certificaciones con términos coincidentes) **no se recortan por los límites de cantidad**: cuentan para el límite
   y se cortan los demás. Se aplica en `trimProfile` (`SectionLimits.keep`: ids protegidos) a partir del informe de
   coincidencia; el informe de decisiones lo cuenta («4 evidencias conservadas por la oferta»). Opción de salida:
   `--no-keep-evidence` en la CLI y `keepEvidence: false` en la API (por defecto activado).
3. **Un solo gesto en la GUI.** El panel de adecuación gana «Generar con esta adecuación»: fija la especialidad
   sugerida si el paso 1 está vacío, conserva la oferta y lanza la generación; el aviso de éxito indica cuántas
   evidencias se conservaron.

## §3 Fuera de alcance

Cambiar la puntuación; inventar contenido; tocar el co-piloto. La CLI sin oferta no cambia.

## §4 Pruebas

Núcleo al 100 % (`trim.ts` con `keep`, `suggestedSpecialty`); CLI (`analyze-offer` imprime la sugerencia; `generate-cv`
con `--no-keep-evidence`); API (contrato y rutas); GUI (formulario y panel); arnés `core`: pasos de análisis y de
generación con oferta y `--top-n` corto que muestren la evidencia conservada y el recorte de lo demás; goldens
regenerados.

## §5 Decisiones que se piden al PO

1. **D1** `keepEvidence` activado por defecto (con opción de salida), porque es lo que un usuario espera al generar
   «para esta oferta».
2. **D2** La especialidad sugerida **no** se aplica sola en la CLI (solo se imprime); en la GUI se rellena si el
   campo está vacío.
3. **D3** Versión: 1.8.0.
