## Ejemplos

```bash
cv import-linkedin ~/Downloads/Basic_LinkedInDataExport.zip   # borrador de fuentes en import/<nombre>/
cv import-linkedin export.zip --name mi-cv                    # carpeta destino a tu gusto
cv import-linkedin export.zip --replace                       # sustituye un borrador anterior
cv build --data import/mi-cv                                  # valida el borrador antes de moverlo a data/sources/
```

- El archivo es el de **Ajustes → Privacidad de datos → Obtener una copia de tus datos** de LinkedIn; con el
  básico basta. La **URL de un perfil no sirve** y no se descarga: el `robots.txt` de LinkedIn prohíbe el acceso
  automatizado y esa URL devuelve el muro de acceso, no el CV. Esta orden no abre ninguna conexión de red.
- Se leen `Profile.csv` (nombre, titular, resumen, ubicación y enlaces), `Positions.csv` (experiencia; sin
  `Finished On`, el puesto queda **en curso**), `Education.csv`, `Certifications.csv`, `Projects.csv`,
  `Skills.csv`, `Languages.csv` —con los cinco niveles de LinkedIn traducidos a MCER—, `Email Addresses.csv` (el
  marcado como principal) y `PhoneNumbers.csv`. Lo que no esté en el zip, no aparece.
- Escribe un **borrador**, nunca en `data/sources/`: mismo destino, mismo informe y misma validación entidad a
  entidad que `cv import-cv`. La diferencia se ve en el informe: al venir de datos estructurados **no hay líneas
  «sin situar»**, así que aquí solo aparece lo que el esquema haya degradado con su motivo.
- Revisa, ajusta y muévelo a mano cuando esté a tu gusto.
