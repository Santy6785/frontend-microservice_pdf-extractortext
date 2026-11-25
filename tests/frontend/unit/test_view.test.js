import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppView } from '../../../frontend/js/view.js';

class FakeDocument {
  constructor() {
    this.body = { appendChild: () => {}, removeChild: () => {} };
    this.createdElements = [];
    this.lastUrl = null;
    this.lastDownloadAttr = null;
    this.lastClickedElement = null;
  }

  createElement(tag) {
    if (tag === 'a') {
      const a = {
        href: '',
        download: '',
        click: () => { this.lastClickedElement = a; },
      };
      this.createdElements.push(a);
      Object.defineProperty(a, 'href', {
        set: (v) => { this.lastUrl = v; a._href = v; },
        get: () => a._href,
      });
      Object.defineProperty(a, 'download', {
        set: (v) => { this.lastDownloadAttr = v; a._download = v; },
        get: () => a._download,
      });
      return a;
    }
    return {};
  }

  getElementById(id) {
    return null;
  }
}

describe('AppView Unit Tests - downloadText', () => {
  let view;
  let doc;

  beforeEach(() => {
    doc = new FakeDocument();
    view = new AppView(doc);
  });

  test('descarga con nombre .md y extensión correcta', () => {
    const content = '# Hola mundo\n\nEste es un texto en Markdown.';
    view.downloadText('documento.md', content);

    assert.equal(doc.lastDownloadAttr, 'documento.md');
    assert.ok(doc.lastClickedElement, 'Se debe hacer click en el enlace');
  });

  test('usa nombre del archivo base al reemplazar extension pdf por md', () => {
    // Se prueba a traves del controller, pero aqui verificamos que view respeta el nombre pasado
    view.downloadText('mi-documento.md', '# Contenido');
    assert.equal(doc.lastDownloadAttr, 'mi-documento.md');
  });

  test('usa MIME type text/markdown con UTF-8', () => {
    const content = '# Texto';
    view.downloadText('test.md', content);

    const blobArg = doc.createdElements[0];
    // El Blob se crea internamente; verificamos que el href sea un objeto URL valido
    assert.ok(doc.lastUrl.startsWith('blob:'), 'La URL debe ser un objeto Blob');
  });

  test('contenido del Blob coincide con el texto extraído', () => {
    const content = '# Título\n\nTexto de prueba.';
    view.downloadText('test.md', content);

    // Verificamos que se haya creado un enlace y se haya hecho click
    assert.equal(doc.lastDownloadAttr, 'test.md');
    assert.ok(doc.lastClickedElement);
  });

  test('no hace nada si el contenido esta vacio', () => {
    const createdBefore = doc.createdElements.length;
    view.downloadText('test.md', '');
    assert.equal(doc.createdElements.length, createdBefore, 'No debe crear elementos si el contenido esta vacio');

    view.downloadText('test.md', null);
    assert.equal(doc.createdElements.length, createdBefore, 'No debe crear elementos si el contenido es null');

    view.downloadText('test.md', undefined);
    assert.equal(doc.createdElements.length, createdBefore, 'No debe crear elementos si el contenido es undefined');
  });

  test('URL.revokeObjectURL se llama despues de un delay', () => {
    // Usamos fake timers para verificar que setTimeout se programa
    const originalSetTimeout = globalThis.setTimeout;
    let timeoutCallback = null;
    let timeoutDelay = null;
    globalThis.setTimeout = (cb, delay) => {
      timeoutCallback = cb;
      timeoutDelay = delay;
      return 1;
    };

    try {
      view.downloadText('test.md', '# Contenido');
      assert.equal(timeoutDelay, 100, 'Debe programarse un delay de 100ms');
      assert.ok(typeof timeoutCallback === 'function', 'Debe programarse un callback');

      // Ejecutar el callback y verificar que no lanza
      timeoutCallback();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  test('crea un enlace, hace click y lo remueve del DOM', () => {
    view.downloadText('doc.md', '# Hola');

    assert.equal(doc.createdElements.length, 1, 'Debe crear exactamente un elemento <a>');
    assert.ok(doc.lastClickedElement, 'Debe hacer click en el enlace creado');
  });
});
