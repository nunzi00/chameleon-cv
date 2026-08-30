## Ejemplos

```bash
cv llm models            # catálogo de modelos locales: familia, razonamiento, tamaño, RAM, licencia, tareas y espejo, con lo descargado
cv llm models --json     # lo mismo en JSON (catálogo con present/sizeBytes/configured, otros modelos presentes, running, disabled)
```

- Con Ollama en marcha, cada modelo dice si está descargado y cuánto ocupa; parado, la columna queda «sin comprobar».
- «Otros modelos presentes» son los que Ollama lista fuera del catálogo (por ejemplo, los `hf.co/…` de los espejos).
- Para descargar uno: `cv llm up --model <id>`; si el registro de Ollama falla y el catálogo tiene espejo en Hugging Face, se descarga el espejo y se crea el alias con el nombre corto.
