import { describe, it, assert } from 'node:test';
import crypto from 'node:crypto';

const BASE_URL = (process.env.E2E_BASE_URL || 'https://universidad.localhost').replace(/\/+$/, '');

// Permitir certificados autofirmados locales de Traefik (universidad.localhost)
if (BASE_URL.startsWith('https://') && process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/**
 * Construye un PDF 1.4 válido y único por ejecución (para evitar colisiones
 * con ejecuciones previas antes del primer upload).
 */
function buildUniqueValidPdf(runId) {
  const text = `E2E Full Flow Test ${runId}`;
  const streamContent = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj',
    `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj'
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${obj}\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'utf8');
}

function createUploadFormData(pdfBuffer, filename) {
  const formData = new FormData();
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
  formData.append('file', blob, filename);
  return formData;
}

describe(`E2E Full Flow contra ${BASE_URL} (Issue #43)`, () => {
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const filename = `e2e-flow-${runId}.pdf`;
  const pdfBuffer = buildUniqueValidPdf(runId);
  let createdDocId = null;

  it('0. Verifica disponibilidad de Front-End (/health) y Orquestador (/api/v1/health) vía Traefik', async () => {
    const frontRes = await fetch(`${BASE_URL}/health`);
    assert.strictEqual(frontRes.status, 200, `Front-End /health devolvió ${frontRes.status}`);

    const apiRes = await fetch(`${BASE_URL}/api/v1/health`);
    assert.strictEqual(apiRes.status, 200, `Orquestador /api/v1/health devolvió ${apiRes.status}`);
  });

  it('1. Upload inicial -> 200 (crea documento y extrae texto)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/documents/upload`, {
      method: 'POST',
      body: createUploadFormData(pdfBuffer, filename)
    });

    assert.ok([200, 201].includes(res.status), `Esperado 200/201, recibido ${res.status}`);
    const body = await res.json();
    assert.ok(body.id, 'La respuesta debe incluir id');
    assert.ok(body.checksum, 'La respuesta debe incluir checksum');
    assert.ok(typeof body.extracted_text === 'string', 'La respuesta debe incluir extracted_text');

    createdDocId = body.id;
  });

  it('2. Upload repetido del mismo PDF -> 409 Conflict', async () => {
    assert.ok(createdDocId, 'Requiere documento creado en el paso 1');

    const res = await fetch(`${BASE_URL}/api/v1/documents/upload`, {
      method: 'POST',
      body: createUploadFormData(pdfBuffer, filename)
    });

    assert.strictEqual(res.status, 409, `Esperado 409 Conflict en upload duplicado, recibido ${res.status}`);
  });

  it('3. Listado de documentos -> 200 y contiene el documento subido', async () => {
    assert.ok(createdDocId, 'Requiere documento creado en el paso 1');

    const res = await fetch(`${BASE_URL}/api/v1/documents/?skip=0&limit=50`);
    assert.strictEqual(res.status, 200, `Esperado 200 en listado, recibido ${res.status}`);

    const list = await res.json();
    assert.ok(Array.isArray(list), 'El listado debe retornar un array plano DocumentListDTO[]');
    const found = list.find((doc) => doc.id === createdDocId);
    assert.ok(found, `El documento ${createdDocId} debe aparecer en el listado`);
  });

  it('4. Detalle de documento -> 200 con metadatos y texto extraído', async () => {
    assert.ok(createdDocId, 'Requiere documento creado en el paso 1');

    const res = await fetch(`${BASE_URL}/api/v1/documents/${encodeURIComponent(createdDocId)}`);
    assert.strictEqual(res.status, 200, `Esperado 200 en detalle, recibido ${res.status}`);

    const detail = await res.json();
    assert.strictEqual(detail.id, createdDocId);
    assert.ok(detail.checksum, 'Detalle debe incluir checksum');
    assert.ok(typeof detail.extracted_text === 'string', 'Detalle debe incluir extracted_text');
  });

  it('5. Delete de documento -> 200/204 y posterior GET devuelve 404', async () => {
    assert.ok(createdDocId, 'Requiere documento creado en el paso 1');

    const delRes = await fetch(`${BASE_URL}/api/v1/documents/${encodeURIComponent(createdDocId)}`, {
      method: 'DELETE'
    });
    assert.ok([200, 204].includes(delRes.status), `Esperado 200/204 en DELETE, recibido ${delRes.status}`);

    const verifyRes = await fetch(`${BASE_URL}/api/v1/documents/${encodeURIComponent(createdDocId)}`);
    assert.strictEqual(verifyRes.status, 404, `Esperado 404 tras eliminar el documento, recibido ${verifyRes.status}`);
  });

  it('6. Re-upload tras Delete -> 200 (permite volver a subir el PDF eliminado)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/documents/upload`, {
      method: 'POST',
      body: createUploadFormData(pdfBuffer, filename)
    });

    assert.ok([200, 201].includes(res.status), `Esperado 200/201 al re-subir tras DELETE, recibido ${res.status}`);
    const body = await res.json();
    assert.ok(body.id, 'La respuesta del re-upload debe incluir id');

    // Limpieza final para no dejar datos residuales de test en el entorno
    if (body.id) {
      await fetch(`${BASE_URL}/api/v1/documents/${encodeURIComponent(body.id)}`, {
        method: 'DELETE'
      });
    }
  });
});
