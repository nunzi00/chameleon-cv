## Ejemplos

```bash
cv drafts duplicates                           # grupos de entradas que parecen la misma cosa
cv drafts duplicates -d data/sources           # comparando contra otras fuentes
```

- Con varios CV de la misma persona, el mismo empleo aparece en todos y **cada CV se contradice con los demás**:
  fechas distintas, empresa y puesto intercambiados, texto espaciado letra a letra. Por eso esto **agrupa y
  pregunta**: no fusiona nada ni elige por ti.
- Cada grupo enseña todos sus miembros con el borrador del que vienen, y marca **`YA TIENES UNA EN TUS FUENTES`**
  cuando una de las entradas es tuya: adoptar otra la duplicaría de verdad.
- Dos entradas van al mismo grupo si sus periodos coinciden y sus palabras se parecen. Lo que el importador escribe
  cuando no reconoció el dato («Empresa pendiente») no cuenta: es la marca de que falta, no un nombre.
- Elige el miembro que prefieras y adóptalo con `cv drafts adopt <borrador> --entry <id>`.
