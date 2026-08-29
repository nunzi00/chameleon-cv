/** Página mínima de `cv serve` cuando la interfaz web no viene en la compilación (desarrollo sin `npm run gui:build`). */
export function fallbackPage(version: string, workspace: string): string {
  const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chameleon CV · cv serve</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1rem; color: #1b1b1b; line-height: 1.5; }
code { background: #eef4fa; padding: .1rem .3rem; border-radius: .25rem; }
h1 { color: #1f4e79; }
</style>
</head>
<body>
<h1>Chameleon CV ${escape(version)}</h1>
<p>Servidor local en marcha sobre <code>${escape(workspace)}</code>. La API vive en <code>/api/v1/</code> y exige la cabecera <code>Authorization: Bearer &lt;token&gt;</code>; el token está en el fragmento de la URL que imprimió <code>cv serve</code> (nunca viaja en las peticiones ni queda en registros).</p>
<p>La interfaz web no viene en esta compilación: en el repositorio, constrúyela con <code>npm run gui:build</code> y vuelve a cargar esta página.</p>
</body>
</html>
`;
}
