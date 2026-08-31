---
title: Importar un CV que ya tienes
---

# Importar un CV que ya tienes

Si llegas con un CV en PDF o DOCX, `cv import-cv` lo convierte en un **borrador de fuentes** para que no empieces de
cero. El borrador se escribe en `import/<nombre>/` y **nunca** en `data/sources/`: lo revisas, lo ajustas y lo mueves
tú cuando estés conforme.

```bash
cv import-cv cv-antiguo.pdf              # borrador en import/<nombre>/ con su informe
cv build --data import/cv-antiguo        # valida el borrador tal cual, antes de moverlo
```

En la interfaz web (`cv serve`) la misma importación está en **Perfil → Importar CV**.

## Qué hace y qué no

- **Determinista**: reconstruye el orden de lectura desde la maquetación (columnas, tablas con las fechas al margen,
  viñetas partidas), reconoce las secciones por sus títulos en español e inglés y valida cada entrada contra el
  esquema del perfil, **entidad a entidad**: lo que no cumple se degrada con su motivo, no se descarta en silencio.
- **No inventa nada**: lo que no encaja va al `README.md` del borrador, en «Degradado o avisado» (con la línea de
  origen) y «Sin situar (revísalo a mano)».
- **Sin red y sin modelo** salvo que pidas el co-piloto con `--copilot`.

## El informe del borrador

El `README.md` del borrador es el mapa de la revisión. Empieza por sus avisos de calidad, que te dicen si merece la
pena seguir:

| Aviso | Qué significa |
| --- | --- |
| «el texto extraído es muy corto» | el PDF es una imagen sin capa de texto: no hay nada que importar |
| «parece un escaneo con OCR de baja calidad» | el texto llega con residuos (`201&` por `2018`): revisa fechas y centros |
| «parece una plantilla sin rellenar» | el fichero es una plantilla o una guía, no un CV |
| «no se reconoció ninguna entrada con fechas» | puede no ser un CV, o su maquetación no se reconoce |
| «formación con una sola fecha» | la fecha de graduación se tomó como inicio: ajústala si procede |

## Pedir ayuda al co-piloto

Con `--copilot`, las líneas que quedaron **sin situar** se envían al modelo —seudonimizadas, sin nombre ni datos de
contacto— para que **proponga** a qué sección pertenecen:

```bash
cv import-cv cv-antiguo.pdf --copilot
```

Las propuestas aparecen en el `README.md` bajo «Propuestas del co-piloto (no aplicadas)» con su justificación. El
modelo **solo clasifica dentro de un vocabulario cerrado** (experiencia, formación, proyecto, certificación,
habilidad, idioma, logro, resumen, contacto, descartar) y el código verifica cada propuesta antes de mostrarla:
descarta las secciones inventadas, las líneas que no se enviaron y las repetidas. **Nada se escribe en el borrador**:
mueves tú lo que te convenza.

Si eliges un proveedor remoto (`--provider`), verás antes el aviso de coste y tendrás que confirmarlo (`--yes` en
scripts).

## Después de importar

1. Lee el `README.md` y corrige lo señalado.
2. Valida: `cv build --data import/<nombre>`.
3. Mueve las fuentes a `data/sources/` cuando estén a tu gusto y sigue con [Generar el CV](/guide/generate).
