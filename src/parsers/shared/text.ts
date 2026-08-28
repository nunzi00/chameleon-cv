/** Primera línea de un texto (los mensajes de las librerías suelen traer un extracto multilínea). */
export function firstLine(text: string): string {
  const newline = text.indexOf('\n');
  return newline === -1 ? text : text.slice(0, newline);
}
