import { describe, it, assert } from 'node:test';
const ORCHESTRATOR_BASE_URL = process.env.ORCHESTRATOR_BASE_URL;

describe('Contract: live checks against real orchestrator', () => {
  if (!ORCHESTRATOR_BASE_URL) {
    it('skip: set ORCHESTRATOR_BASE_URL to run live contract tests', () => {
      assert(true);
    });
    return;
  }

  it('GET /health returns 200 JSON', async () => {
    const url = new URL(`${ORCHESTRATOR_BASE_URL}/health`);
    const res = await fetch(url);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const json = await res.json();
    assert(json.status === 'ok', `Expected status ok, got ${json}`);
  });

  it('GET listado paginado returns 200 with DTO shape', async () => {
    const url = new URL(`${ORCHESTRATOR_BASE_URL}/api/v1/documents/?skip=0&limit=1`, ORCHESTRATOR_BASE_URL);
    const res = await fetch(url);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const json = await res.json();
    assert(Array.isArray(json), `Expected array, got ${typeof json}`);
    if (json.length > 0) {
      assert(json[0].hasOwnProperty('id'), 'Expected id property');
      assert(json[0].hasOwnProperty('checksum'), 'Expected checksum property');
      assert(json[0].hasOwnProperty('created_at'), 'Expected created_at property');
    }
  });

  it('GET document inexistente returns 404 JSON', async () => {
    const url = new URL(`${ORCHESTRATOR_BASE_URL}/api/v1/documents/nonexistent-id-12345`, ORCHESTRATOR_BASE_URL);
    const res = await fetch(url);
    assert(res.status === 404, `Expected 404, got ${res.status}`);
    const json = await res.json();
    assert(json.detail.includes('no encontrado'), `Expected "no encontrado" in detail, got ${json.detail}`);
  });

  it('POST upload PDF mínimo retorna 200/201 con DTO esperado', async () => {
    const minPdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n%%EOF', 'utf8');
    const formData = new FormData();
    formData.append('file', minPdf, 'test.pdf');

    const url = new URL(`${ORCHESTRATOR_BASE_URL}/api/v1/documents/upload`, ORCHESTRATOR_BASE_URL);
    const res = await fetch(url, { method: 'POST', body: formData });
    assert([200, 201].includes(res.status), `Expected 200/201, got ${res.status}`);
    const json = await res.json();
    assert(json.id !== undefined, 'Expected id property');
    assert(json.checksum !== undefined, 'Expected checksum property');
    assert(json.extracted_text !== undefined, 'Expected extracted_text property');
    assert(json.created_at !== undefined, 'Expected created_at property');
  });

  it('Repeated file upload returns 409', async () => {
    const minPdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n%%EOF', 'utf8');
    const formData = new FormData();
    formData.append('file', minPdf, 'test.pdf');

    const url = new URL(`${ORCHESTRATOR_BASE_URL}/api/v1/documents/upload`, ORCHESTRATOR_BASE_URL);
    const res = await fetch(url, { method: 'POST', body: formData });
    assert([409].includes(res.status), `Expected 409, got ${res.status}`);
  });

  it('Uploaded document can be retrieved and deleted', async () => {
    const minPdf = Buffer.from('%PDF-1.4\n%âãÏÓ\n%%EOF', 'utf8');
    const formData = new FormData();
    formData.append('file', minPdf, 'test.pdf');

    const uploadUrl = new URL(`${ORCHESTRATOR_BASE_URL}/api/v1/documents/upload`, ORCHESTRATOR_BASE_URL);
    const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData });
    expect([200, 201]).toContain(uploadRes.status);
    const uploadJson = await uploadRes.json();
    const docId = uploadJson.id;

    const getUrl = new URL(`${ORCHESTRATOR_BASE_URL}/api/v1/documents/${docId}`, ORCHESTRATOR_BASE_URL);
    const getRes = await fetch(getUrl);
    assert(getRes.status === 200, `Expected 200, got ${getRes.status}`);
    const getJson = await getRes.json();
    assert(getJson.id === docId, `Expected id match`);

    const deleteUrl = new URL(`${ORCHESTRATOR_BASE_URL}/api/v1/documents/${docId}`, ORCHESTRATOR_BASE_URL);
    const deleteRes = await fetch(deleteUrl, { method: 'DELETE' });
    assert(deleteRes.status === 204, `Expected 204, got ${deleteRes.status}`);
  });
});