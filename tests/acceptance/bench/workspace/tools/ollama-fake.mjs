// Doble de Ollama para el arnés (T-8.8). Determinista: versión fija, progreso fijo, modelos en un fichero del HOME.
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const stateFile = join(process.env.HOME ?? '.', '.ollama-fake.json');
const models = () => {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return [];
  }
};
const [command, argument] = process.argv.slice(2);

if (command === '--version') {
  console.log('ollama version is 0.33.2-fake');
} else if (command === 'pull') {
  if (argument === undefined || argument.includes('inexistente')) {
    console.error(`Error: pull model manifest: file does not exist: ${argument ?? ''}`);
    process.exit(1);
  }
  console.log('pulling manifest');
  console.log('pulling 8934d96d3f08: 100%');
  console.log('success');
  const list = models();
  if (!list.includes(argument)) {
    writeFileSync(stateFile, JSON.stringify([...list, argument]));
  }
} else if (command === 'serve') {
  const [host, port] = (process.env.OLLAMA_HOST ?? '127.0.0.1:11434').split(':');
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/version') {
      response.end(JSON.stringify({ version: '0.33.2-fake' }));
    } else if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: models().map((name) => ({ name })) }));
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  server.listen(Number(port), host);
  process.on('SIGTERM', () => process.exit(0));
} else {
  console.error(`orden desconocida: ${command ?? ''}`);
  process.exit(2);
}
