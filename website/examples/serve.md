## Ejemplos

```bash
cv serve                                  # http://127.0.0.1:4310/ · imprime la URL con el token de sesión (Ctrl-C para parar)
cv serve --open                           # además abre el navegador con la URL y el token
cv serve --port 0 --api-only              # puerto efímero y solo /api/v1 (pruebas, clientes propios)
cv serve --workspace ~/mi-cv              # otro espacio de trabajo
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4310/api/v1/status
```

- Solo escucha en `127.0.0.1`; cada petición exige `Authorization: Bearer <token>` (el token está en el fragmento de la URL, que nunca viaja); `Host` y `Origin` se comprueban; no hay CORS. El contrato completo está en la [nota de diseño de la API](/design/api-headless) del portal.
- `--host 0.0.0.0` solo tiene sentido dentro de un contenedor cuyo puerto publique Docker en el loopback del anfitrión (`compose.serve.yml`).
