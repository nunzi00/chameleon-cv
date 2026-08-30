## Ejemplos

```bash
cv theme list       # nombre, origen (distribuido o themes/ del proyecto), descripción, validez y cuál es el tema por defecto
```

- Los temas salen agrupados por lo que aportan (T-8.12): primero las **organizaciones** (cambian el orden y la agrupación de las secciones), después los **estilos** (la cronológica inversa con otra maquetación) y al final los temas sin `kind` en su `theme.toml`; el resumen de `stderr` cuenta cada grupo.
- Dentro de cada grupo, los temas del proyecto van primero y ocultan a un distribuido con el mismo nombre; los inválidos aparecen con su motivo.
