# Contrato de Consumidor: Front-end ↔ Orquestador (Backend FastAPI)

**Propósito:** Este documento define el contrato consumidor-driven que el microservicio front-end espera del orquestador (backend FastAPI). Está dirigido al equipo del orquestador para su adopción. Hasta que sea adoptado oficialmente, permanece como propuesta.

**Alcance:** Solo los endpoints consumidos por el front-end tal como están implementados en `frontend/js/api-client.js`. No cubre toda la API del orquestador.

**Base URL y prefijo:** `https://universidad.localhost/api/v1`
El front accede a todos los endpoints bajo el prefijo `/api/v1` a través de Traefik, que enruta sin `StripPrefix`. El navegador comparte el mismo origen (`https://universidad.localhost`) y Traefik enruta según la regla `Host(universidad.localhost) && PathPrefix(/api)`.

---

## 1. Endpoints consumidos por el front

### 1.1. POST /api/v1/documents/upload (Subir y procesar PDF)

| Campo | Descripción |
|---|---|
| **Método** | POST |
| **Ruta** | /api/v1/documents/upload |
| **Propósito** | Subida y extracción síncrona de PDF. Validación de SHA-256, comprobación de duplicados, extracción de texto y persistencia en MongoDB. |
| **Content-Type** | `multipart/form-data` |
| **Cuerpo (Form Data)** | - `file`: Archivo binario (`application/pdf`, extensión `.pdf`, tamaño máximo configurado, por defecto 10 MB) |
| **Headers** | (vacíos por defecto; el front no añade headers personalizados para este endpoint) |
| **Reintentos** | **NUNCA** automática (`allowRetry: false` en `api-client.js`) para evitar dobles envíos |
| **Éxito (200)** | **Campos que usa la UI:**<br>`id` (string): identificador del documento<br>`checksum` (string, sha256 hex): huella del archivo<br>`extracted_text` (string): texto extraído del PDF<br>`created_at` (string, ISO 8601): fecha de creación |
| **Errores comunes** | |
| 400 | `El archivo debe ser un PDF. Tipo recibido: <mime>` o `El archivo debe tener extension .pdf` o `El archivo excede el tamaño máximo permitido de 10MB` |
| 409 | `Ya existe un documento con el mismo checksum` (duplicado) |
| 422 | `No se pudo procesar el PDF: <mensaje_error>` (PDF corrupto/protegido) o errores de validación Pydantic |
| **Efectos colaterales** | - Se calcula checksum SHA-256 en el cliente<br>- El front muestra mensajes traducidos: "El archivo ya existe en el sistema.", "El archivo no es un PDF válido o está corrupto.", etc.<br>- Si el checksum ya existe, el flujo E2E es: Upload → 409 Duplicate → Delete → nuevo Upload |
| **Aspectos no funcionales** | - Timeouts configurables vía `REQUEST_TIMEOUT_MS` (default: 30000 ms)<br>- Tamaño máximo configurable vía `MAX_UPLOAD_MB` (default: 10 MB)<br>- **SIN reintento automático** para POST (idempotencia no aplicable) |

---

### 1.2. GET /api/v1/documents/ (Listado paginado de documentos)

| Campo | Descripción |
|---|---|
| **Método** | GET |
| **Ruta** | /api/v1/documents/ **_(obsolto/deprecated según openapi.json)_**<br>**Oppure** `/api/v1/documents/?skip=0&limit=20` (usado por el front actual) |
| **Propósito** | Listar documentos almacenados de forma paginada |
| **Query Parameters** | - `skip` (entero, `ge=0`, default: `0`): número de documentos a omitir<br>- `limit` (entero, `ge=1`, default: `20` según `Settings.default_page_size`) |
| **Idempotente** | Sí: se reintenta con backoff exponencial en fallos transitorios (502, 503, 504) |
| **Éxito (200)** | **Cuerpo:** Array de `DocumentListDTO`:<br>`[ { id: string, checksum: string, created_at: string (ISO 8601) } ... ]` |
| **Errores** | - 422: Si los parámetros no cumplen restricciones (ej. `limit=0` o `skip=-1`). Retorna lista `detail` de validación Pydantic |
| **Aspectos no funcionales** | - Formato de respuesta compatible con la UI de "Verificación" y "Texto Extraído"<br>- El front usa los campos `id`, `checksum`, `created_at` de cada elemento |

---

### 1.3. GET /api/v1/documents/{id} (Detalle de documento)

| Campo | Descripción |
|---|---|
| **Método** | GET |
| **Ruta** | /api/v1/documents/{id} (el `{id}` es el ObjectId string del documento) |
| **Path Parameter** | - `id` (string, obligatorio): identificador del documento |
| **Idempotente** | Sí: se reintenta con backoff en fallos transitorios |
| **Éxito (200)** | **Cuerpo:** `DocumentResponseDTO`:<br>`{ id: string, checksum: string, extracted_text: string, created_at: string (ISO 8601) }` |
| **Errores** | - 404: `{"detail": "Documento con id <id> no encontrado"}`<br>- 422: Si el formato de parámetros de ruta no es válido |
| **Aspectos no funcionales** | - El front navega a este endpoint para ver el texto extraído de un documento específico |

---

### 1.4. PUT /api/v1/documents/{id} (Actualizar texto extraído)

| Campo | Descripción |
|---|---|
| **Método** | PUT |
| **Ruta** | /api/v1/documents/{id} |
| **Content-Type** | `application/json` |
| **Cuerpo JSON** | - `extracted_text` (string, obligatorio): texto extraído a actualizar |
| **Idempotente** | **NUNCA** automática (`allowRetry: false`) |
| **Éxito (200)** | **Cuerpo:** `DocumentResponseDTO` con el texto actualizado |
| **Errores** | - 404: `{"detail": "Documento con id <id> no encontrado"}`<br>- 422: Si falta `extracted_text` o el tipo no es string |
| **Aspectos no funcionales** | - El front actualiza el texto en la UI después de procesar un PDF |

---

### 1.5. DELETE /api/v1/documents/{id} (Eliminar documento)

| Campo | Descripción |
|---|---|
| **Método** | DELETE |
| **Ruta** | /api/v1/documents/{id} |
| **Idempotente** | **NUNCA** automática (`allowRetry: false`) |
| **Éxito (204)** | **Cuerpo:** Sin contenido (204 No Content) |
| **Errores** | - 404: `{"detail": "Documento con id <id> no encontrado"}`<br>- 502/503/504: Si el backend cae o el circuito está abierto (Traefik) |
| **Aspectos no funcionales** | - El front elimina el documento para restablecer el flujo de prueba E2E (Upload → 409 Duplicate → Delete)<br>- Mensaje en UI: "Eliminar documento del sistema" |

---

### 1.6. GET /health (Health check del front/proxy)

| Campo | Descripción |
|---|---|
| **Método** | GET |
| **Ruta** | /health |
| **Propósito** | Health check estático para Docker y Traefik. Retorna `200 OK` con JSON `{"status":"ok","service":"frontend"}`. |
| **Idempotente** | Sí: se reintenta con backoff en fallos transitorios |
| **Éxito (200)** | **Cuerpo:** `{"status":"ok","service":"frontend"}` con `Content-Type: application/json` |
| **Errores** | - 503 si el servicio no está disponible (desde Traefik) |
| **Aspectos no funcionales** | - Usado por Traefik para determinar si el front debe seguir en el load balancer<br>- También consumido directamente por `api-client.checkHealth()` en los tests unitarios |

---

## 2. Garantías que el front exige al orquestador

Estas son las garantías que el front-end espera del orquestador (backend FastAPI) para funcionar correctamente:

1. **Respuestas en JSON:** Todos los endpoints deben retornar cuerpos en formato JSON ( salvo el 204 No Content en DELETE y el 200 text/plain del legacy). El front usa `_parseResponseBody` que intenta `JSON.parse` y tolera respuestas no-JSON (ej. HTML de proxy) retornando `{ raw: text }`.

2. **Códigos HTTP estándar:** Uso de códigos 200, 204, 400, 404, 409, 422, 502, 503, 504, 429, 408 según spec. No se esperan códigos no estándar.

3. **No quitar el prefijo `/api/v1`:** Traefik ya enruta sin `StripPrefix`. Si el orquestador define sus rutas sin el prefijo `/api/v1`, el front no funcionaría porque `api-client.js` construye URLs combinando `basePath` + `path`.

4. **Errores en JSON estructurado:** Los errores deben venir con `{"detail": "mensaje"}` (para errores 400, 404, 409, 422) o arrays devalidación Pydantic `[{loc, msg, type}]`. El front tolera ambas formas.

5. **Caídas y degradación:** Ante caída de dependencias (MongoDB, etc.), el orquestador debe retornar 502, 503 o 504. El front muestra: "Servicio temporalmente no disponible. Por favor, reintente en unos instantes."

6. **Rate limiting (429):** Si se excede el límite de peticiones, el front muestra: "Demasiadas solicitudes. Por favor, espere un momento antes de reintentar." y **solo reintenta GET** (no POST).

7. **Tamaño máximo de archivo:** El front valida en cliente (`MAX_UPLOAD_MB` default 10 MB) y el backend debe hacer cumplir el mismo límite. Si el archivo pasa el check cliente pero el backend lo rechaza, se devuelve 400/413.

8. **No cambiar esquemas sin avisar:** El front usa campos concretos de los DTOs (`id`, `checksum`, `extracted_text`, `created_at`). Cambiar el orden o tipos de estos campos rompería la UI sin previo aviso.

---

## 3. Cambios que romperían al front

Estos cambios en el orquestador romperían la compatibilidad hacia atrás con el front-end actual. **Cuidado al modificarlos:**

1. **Cambiar el prefijo de ruta:** Mover endpoints de `/api/v1/...` a otra ruta (ej. `/api/...` o `/v2/...`) sin actualizar `api-client.js` rompería todas las llamadas HTTP.

2. **Eliminar o renombrar campos DTO:** Borrar o renombrar `id`, `checksum`, `extracted_text` o `created_at` de los DTOs provocaría `undefined` en la UI y errores en la consola.

3. **Cambiar el tipo de un campo DTO:** Ej. cambiar `checksum` de `string` a `object` provocaría fallos en la UI que espera una cadena hexadecimal.

4. **Quitar la validación del tamaño máximo en el backend:** Si el backend elimina la validación de `MAX_UPLOAD_MB`, los usuarios podrían subir archivos muy grandes, afectando el servicio y la UI (el campo `fileSize` en la UI no limitaría el envío).

5. **Cambiar el comportamiento del rate limiting:** Si el backend deja de devolver 429 y siempre responde 200, el front no limitaría la tasa de peticiones, saturando el servicio.

6. **Cambiar el endpoint `/health`:** Si el health check deja de retornar `{"status":"ok","service":"frontend"}` o cambia el Content-Type, los tests unitarios y el health check de Traefik fallarían.

---

## 4. Para adoptar en el repo del orquestador

Para adoptar este contrato en el repositorio del orquestador:

1. **Copiar este archivo** a `docs/contratos/frontend-orquestador.md` en el repositorio del orquestador.
2. **Ejecutar la verificación:** El test de contrato (ver paso 5) se ejecuta contra el orquestador real con:
   ```bash
   $env:ORCHESTRATOR_BASE_URL="https://tu-orquestador.localhost"
   npm run test:contract
   ```
3. **Leer las garantías:** Revisar la sección "Garantías que el front exige al orquestador" para asegurar la compatibilidad.
4. **Identificar cambios que romperían:** Revisar la sección "Cambios que romperían al front" antes de hacer cambios en la API.

**Nota importante:** Este documento es una **PROPUESTA del consumidor** (front-end). La adopción yvalidación finales corresponden al equipo del orquestador. No se afirma que haya sido aceptada automáticamente.

---

## 5. Referencias

- `docs/api-contract.md` - Contrato OpenAPI del backend (fuente de verdad oficial)
- `docs/openapi.json` - Snapshot OpenAPI 3.1.0 generado desde `app/main.py`
- `frontend/js/api-client.js` - Implementación concreta de llamadas HTTP
- `docs/verification-report.md` - Resultados de la verificación funcional issue #6
- Issue #3 - Reglas de enrutamiento Traefik (`!PathPrefix`, prioridades)
- Issue #5 - Eliminación de `ports: ["8080:80"]` del frontend

---

## 6. Cómo ejecutar el test de contrato (después de adoptado)

```bash
# Contra el orquestador real (con variable de entorno):
$env:ORCHESTRATOR_BASE_URL="https://tu-orquestador.localhost"
npm run test:contract

# Sin variable (bloque estático, sin red):
npm run test:contract  # el bloque en vivo se saltará
```

**Nota de certificado autofirmado:** Si la URL usa HTTPS con certificado autofirmado, permitirlo SOLO para esta ejecución:
```bash
$env:NODE_TLS_REJECT_UNAUTHORIZED=0 $env:ORCHESTRATOR_BASE_URL="https://tu-orquestador.localhost"
npm run test:contract
```
⚠️ **Riesgo:** Esta variable afecta a todo el proceso Node.js en curso; usarla solo para el comando de prueba y en entornos de desarrollo/test.

---

### Línea de enlace en el README

Añadir en el README (sección de documentación o API):

> **[Contrato de consumidor front-end](contratos/frontend-orquestador.md)**: documento con el contrato de los endpoints consumidos por el microservicio front-end (`POST /api/v1/documents/upload`, `GET /api/v1/documents/?skip=&limit=`, etc.), códigos de error, garantías y cambios que romperían la compatibilidad. Complementa a `docs/api-contract.md` y `docs/openapi.json`.

--- 

Ahora voy a añadir el enlace en el README.</think>Voy a añadir el enlace en el README.
<tool_call>
<function=edit>
<parameter=filePath>
C:\Users\jerek\Desktop\Facultad\3ro\Desarrollo de Software\repo\frontend-microservice_pdf-extractortext\README.md