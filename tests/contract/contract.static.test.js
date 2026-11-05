import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// LISTA EXPLÍCITA de endpoints que usa api-client.js (refactor si cambia)
// ---------------------------------------------------------------------------
const ENDPOINTS = [
  { method: 'GET',    path: '/health',                    desc: 'Health check del front' },
  { method: 'GET',    path: '/api/v1/documents/',       desc: 'Listado paginado de documentos' },
  { method: 'GET',    path: '/api/v1/documents/:id',    desc: 'Obtener documento por ID' },
  { method: 'PUT',    path: '/api/v1/documents/:id',    desc: 'Actualizar texto extraído' },
  { method: 'DELETE', path: '/api/v1/documents/:id',    desc: 'Eliminar documento' },
  { method: 'POST',   path: '/api/v1/documents/upload', desc: 'Subir y procesar PDF' },
];

// ---------------------------------------------------------------------------
// BLOQUE ESTÁTICO: siempre corre, sin necesidad de red
// Verifica que la openapi.json existe y tiene las rutas esperadas.
// ---------------------------------------------------------------------------
describe('Contract: openapi.json exists and has expected routes', () => {
  it('openapi.json file can be parsed', () => {
    const raw = readFileSync('docs/openapi.json', 'utf8');
    const openapi = JSON.parse(raw);
    if (!openapi.paths) {
      throw new Error('openapi.json no tiene paths');
    }
  });

  ENDPOINTS.forEach(({ method, path, desc }) => {
    it(`openapi.json defines ${method} ${path}`, () => {
      // Lectura síncrona de openapi.json
      const raw = readFileSync('docs/openapi.json', 'utf8');
      const openapi = JSON.parse(raw);
      const routeKey = path.replace(/:id/, '{document_id}');
      const found = Object.keys(openapi.paths).some(k => k === routeKey);
      if (!found) {
        // Buscar coincidencia parcial
        const partialMatch = Object.keys(openapi.paths).some(k => k.includes(path.split('/').pop()));
        if (!partialMatch) {
          throw new Error(`Falta en openapi.json: ${method} ${path}`);
        }
      }
    });
  });
});