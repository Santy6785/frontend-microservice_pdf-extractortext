import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ApiClient } from '../../../frontend/js/api-client.js';
import { AppState } from '../../../frontend/js/state.js';
import { AppController } from '../../../frontend/js/controller.js';

describe('MVC Integration Tests (Controller + ApiClient vs OpenAPI Mock Server)', () => {
  let server;
  let serverUrl;
  let mockRoutes = {};

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const routeKey = `${req.method} ${url.pathname}`;
      const handler = mockRoutes[routeKey] || mockRoutes[`${req.method} ANY`];

      if (handler) {
        handler(req, res, url);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Not Found in mock' }));
      }
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        serverUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function setupController(config = {}) {
    const apiClient = new ApiClient({
      basePath: serverUrl,
      timeoutMs: 1500,
      maxRetries: 2,
      retryBaseDelayMs: 20
    });
    const state = new AppState();
    const viewMock = {
      showFileInfo: () => {},
      hideFileInfo: () => {},
      setLoading: () => {},
      showError: (msg) => { viewMock.lastError = msg; },
      hideError: () => { viewMock.lastError = null; },
      showResults: (chk, txt) => { viewMock.lastResults = { chk, txt }; },
      hideResults: () => { viewMock.lastResults = null; },
      lastError: null,
      lastResults: null
    };
    const controller = new AppController({
      apiClient,
      state,
      view: viewMock,
      config: { maxUploadMb: config.maxUploadMb || 10 }
    });
    return { apiClient, state, view: viewMock, controller };
  }

  test('Escenario 1: Subida OK -> 200 DocumentResponseDTO', async () => {
    const mockDocument = {
      id: 'mock-doc-001',
      checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      extracted_text: 'Texto extraido por OpenAPI Mock',
      created_at: '2026-04-27T18:00:00Z'
    };

    mockRoutes['POST /api/v1/documents/upload'] = (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockDocument));
    };

    const { state, view, controller } = setupController();
    const pdf = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
    pdf.name = 'test.pdf';

    controller.handleFileSelected(pdf);
    await controller.processFile();

    assert.equal(view.lastError, null);
    assert.deepEqual(view.lastResults, {
      chk: mockDocument.checksum,
      txt: mockDocument.extracted_text
    });
    assert.equal(state.documentId, 'mock-doc-001');
  });

  test('Escenario 2: Duplicado 409 -> "El archivo ya existe en el sistema."', async () => {
    mockRoutes['POST /api/v1/documents/upload'] = (req, res) => {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Ya existe un documento con el mismo checksum' }));
    };

    const { state, view, controller } = setupController();
    const pdf = new Blob(['%PDF-1.4 dup'], { type: 'application/pdf' });
    pdf.name = 'dup.pdf';

    controller.handleFileSelected(pdf);
    await controller.processFile();

    assert.equal(view.lastError, 'El archivo ya existe en el sistema.');
    assert.equal(state.hasResults, false);
  });

  test('Escenario 3: Archivo invalido 400 devuelto por backend', async () => {
    mockRoutes['POST /api/v1/documents/upload'] = (req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'El archivo debe tener extension .pdf' }));
    };

    const { view, controller } = setupController();
    const badFile = new Blob(['bad content'], { type: 'application/pdf' });
    badFile.name = 'test.bad';
    controller.state.setFile(badFile);
    await controller.processFile();

    assert.equal(view.lastError, 'El archivo no es un PDF válido o está corrupto.');
  });

  test('Escenario 4: Error de procesamiento 422 devuelto por backend', async () => {
    mockRoutes['POST /api/v1/documents/upload'] = (req, res) => {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'No se pudo procesar el PDF: formato corrupto' }));
    };

    const { view, controller } = setupController();
    const pdf = new Blob(['corrupt'], { type: 'application/pdf' });
    pdf.name = 'corrupt.pdf';

    controller.handleFileSelected(pdf);
    await controller.processFile();

    assert.equal(view.lastError, 'El archivo no es un PDF válido o está corrupto.');
  });

  test('Escenario 5: Tamaño excedido validado en cliente', async () => {
    const { view, controller } = setupController({ maxUploadMb: 5 });
    const hugePdf = { name: 'huge.pdf', type: 'application/pdf', size: 6 * 1024 * 1024 };

    controller.handleFileSelected(hugePdf);

    assert.equal(view.lastError, 'El archivo es demasiado grande. Tamaño máximo: 5MB.');
  });

  test('Escenario 6: 404 al consultar o eliminar documento inexistente', async () => {
    mockRoutes['GET /api/v1/documents/inexistente'] = (req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Documento con id inexistente no encontrado' }));
    };
    mockRoutes['DELETE /api/v1/documents/inexistente'] = (req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Documento con id inexistente no encontrado' }));
    };

    const { apiClient } = setupController();

    await assert.rejects(
      async () => apiClient.getDocument('inexistente'),
      (err) => err.status === 404 && err.message.includes('inexistente')
    );

    await assert.rejects(
      async () => apiClient.deleteDocument('inexistente'),
      (err) => err.status === 404 && err.message.includes('inexistente')
    );
  });

  test('Escenario 7: Listado paginado reproduce contrato final de DocumentListDTO[] (O-10 / D2)', async () => {
    const listData = [
      { id: '662d1a000000000000000001', checksum: 'a'.repeat(64), created_at: '2026-04-27T10:00:00Z' },
      { id: '662d1a000000000000000002', checksum: 'b'.repeat(64), created_at: '2026-04-27T11:00:00Z' }
    ];

    mockRoutes['GET /api/v1/documents/'] = (req, res, url) => {
      const skip = Number(url.searchParams.get('skip'));
      const limit = Number(url.searchParams.get('limit'));

      if (skip < 0 || limit < 1 || limit > 100) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          detail: [
            {
              loc: ['query', skip < 0 ? 'skip' : 'limit'],
              msg: 'Input should be greater than or equal to 0',
              type: 'greater_than_equal'
            }
          ]
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (skip >= listData.length) {
        res.end(JSON.stringify([]));
        return;
      }
      res.end(JSON.stringify(listData.slice(skip, skip + limit)));
    };

    const { apiClient } = setupController();

    // 1. Llamada con defaults (skip=0, limit=20) retorna array plano de DocumentListDTO
    const defaultDocs = await apiClient.listDocuments();
    assert.equal(Array.isArray(defaultDocs), true);
    assert.deepEqual(defaultDocs, listData);
    for (const item of defaultDocs) {
      assert.equal(typeof item.id, 'string');
      assert.equal(typeof item.checksum, 'string');
      assert.equal(typeof item.created_at, 'string');
    }

    // 2. Paginacion con skip y limit
    const pagedDocs = await apiClient.listDocuments({ skip: 1, limit: 1 });
    assert.equal(Array.isArray(pagedDocs), true);
    assert.deepEqual(pagedDocs, [listData[1]]);

    // 3. Offset sin resultados retorna array vacio []
    const emptyDocs = await apiClient.listDocuments({ skip: 10, limit: 20 });
    assert.equal(Array.isArray(emptyDocs), true);
    assert.deepEqual(emptyDocs, []);

    // 4. Parametros invalidos (422 Pydantic validation list)
    await assert.rejects(
      () => apiClient.listDocuments({ skip: -1, limit: 0 }),
      (err) => err.status === 422 && Array.isArray(err.detail?.detail)
    );
  });

  test('Escenario 8: 502/503/504 devuelto por proxy Traefik/Nginx', async () => {
    mockRoutes['POST /api/v1/documents/upload'] = (req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Service Unavailable from Traefik');
    };

    const { view, controller } = setupController();
    const pdf = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
    pdf.name = 'test.pdf';

    controller.handleFileSelected(pdf);
    await controller.processFile();

    assert.equal(
      view.lastError,
      'Servicio temporalmente no disponible. Por favor, reintente en unos instantes.'
    );
  });

  test('Escenario 9: 429 Rate Limit excedido', async () => {
    mockRoutes['POST /api/v1/documents/upload'] = (req, res) => {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too Many Requests');
    };

    const { view, controller } = setupController();
    const pdf = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
    pdf.name = 'test.pdf';

    controller.handleFileSelected(pdf);
    await controller.processFile();

    assert.equal(
      view.lastError,
      'Demasiadas solicitudes. Por favor, espere un momento antes de reintentar.'
    );
  });

  test('Escenario 10: Timeout de red', async () => {
    mockRoutes['POST /api/v1/documents/upload'] = () => {
      // Intencionalmente nunca responde para forzar timeout en cliente
    };

    const { apiClient, state, view, controller } = setupController();
    apiClient.timeoutMs = 150; // Timeout corto para test

    const pdf = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
    pdf.name = 'test.pdf';

    controller.handleFileSelected(pdf);
    await controller.processFile();

    assert.equal(
      view.lastError,
      'Tiempo de espera agotado al conectar con el servidor.'
    );
    assert.equal(state.isLoading, false);
  });
});
