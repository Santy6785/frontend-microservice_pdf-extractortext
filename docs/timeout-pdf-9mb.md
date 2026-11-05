# Timeout de subida de PDFs de ~9 MB

## Fecha
5 de noviembre de 2026

## Equipo y versiones
- Ingeniero: Ingeniero Senior de Rendimiento y Front-end
- Repositorio: `frontend-microservice_pdf-extractortext` (microservicio front-end)
- Versión del front: 0.2.0
- Node.js: v24.14.1
- Docker: No accesible (Desktop no corriendo)
- Sistema operativo: Windows 10/11

## Versiones relevantes
- `REQUEST_TIMEOUT_MS`: 30000 (30 s) — valor por defecto en todo el stack
- `MAX_UPLOAD_MB`: 10 — valor por defecto en todo el stack
- validator.js calcula `maxSizeBytes = maxUploadMb * 1024 * 1024` (1 MB = 1.048.576 bytes)

## Backend y camino usado
- **Criterio 1: NO VERIFICADO** — No hay backend real accesible para medir el tiempo de extracción.
  - Docker Desktop no está corriendo, no se puede conectar al daemon.
  - Clasificación: (D) nada — no hay ningún candidato de backend accessible.
  - No se midió contra un mock ni contra un stub, para respetar la regla: "NO midas nada contra un mock y lo presentas como tiempo de extracción".
- **Caminos de tiempoo en el código identificados:**
  - `frontend/js/api-client.js:27` — `this.timeoutMs = options.timeoutMs ?? 30000` (cliente AbortController)
  - `frontend/js/app.js:21` — `requestTimeoutMs: Number(runtimeConfig.REQUEST_TIMEOUT_MS) || 30000`
  - `frontend/config.js:5` — `REQUEST_TIMEOUT_MS: 30000`
  - `frontend/config.template.js:5` — `REQUEST_TIMEOUT_MS: Number("${REQUEST_TIMEOUT_MS}") || 30000`
  - `nginx/40-generate-config.sh:7` — `export REQUEST_TIMEOUT_MS="${REQUEST_TIMEOUT_MS:-30000}"`
  - `docker-compose.yml:17` — `- REQUEST_TIMEOUT_MS=30000`
  - `.env.example:11` — `REQUEST_TIMEOUT_MS=30000`
  - `README.md:114` — documentación del timeout
  - `docs/contratos/frontend-orquestador.md:31` — contrato del orquestador
  - `docs/api-contract.md` — contrato OpenAPI del backend (snapshot)

## Método de medición
- **PDFs utilizados:** Sintéticos generados con script Node en `/tmp/pdf-stress/`
  - PDF base: `/tmp/pdf-stress/test-pdf-9mb-base.pdf` — 9.00 MB, 9433346 bytes, empieza con `%PDF-1.4`
  - 5 variantes con contenido distinto (hash SHA-256 diferente) para evitar rechazo por checksum duplicado:
    - Variante 1: hash `a71f9721a380d33c...`, 9.13 MB
    - Variante 2: hash `0593f72bd9a95dff...`, 9.13 MB
    - Variante 3: hash `2756cfcde75f2993...`, 9.13 MB
    - Variante 4: hash `693c5dba840eeecd...`, 9.13 MB
    - Variante 5: hash `3123ed0a43c921af...`, 9.13 MB
  - Todas las variantes empiezan con `%PDF`, son PDFs sintéticos válidos
  - **Validación contra validator.js:** `maxSizeBytes = 10 * 1024 * 1024 = 10485760 bytes` (10 MB binario)
    - Un archivo de ~9 MB (9.00 MB = 9437184 bytes, o 9.13 MB = 9606674 bytes) queda DENTRO del límite de 10 MB.
    - El cálculo usa 1 MB = 1.048.576 bytes (base 2), no 1.000.000.
- **Calentamiento:** No aplicable (no hubo corridas medibles contra backend real).
- **N corridas:** No applicable (no hay backend medible).

## Conclusión frente al umbral de 25 s
- Dado que no hay backend real contra el que medir, **no es posible determinar** si el tiempo de extracción de un PDF de ~9 MB supera los 25 s.
- El criterio 1 de la issue se marca **NO VERIFICADO**.
- **Decisión:** No se cambia el valor de `REQUEST_TIMEOUT_MS` (se mantiene en 30000 ms / 30 s).
- Justificación: Sin medición real, no procede el ajuste según el criterio 2 de la issue. El timeout actual de 30 s es el valor por defecto configurado en todo el stack (cliente, Docker, .env.example, README).

## Limitaciones honestas
- Los PDFs utilizados son **sintéticos**, generados con un script Node que crea PDFs con texto ficticio en múltiples páginas.
  - Tiempos de extracción con PDFs reales con muchas imágenes o páginas escaneadas pueden ser muy distintos.
  - El extractor del backend (FastAPI/Monolito) puede tener complejidad distinta al mock sintético.
- No se midió tiempo real de extracción contra un backend corriendo (Docker no accessible).
- Los tiempos de Traefik, nginx y el orquestador no fueron medidos porque no hay backend accessible.
- Los tamaños de PDF distintos de 9 MB no fueron probados específicamente; el límite `MAX_UPLOAD_MB = 10` sugiere que archivos entre 8.5 y 9.5 MB están dentro del límite de la interfaz.
- Si el cliente aborta mientras el servidor sigue procesando, el documento puede crearse igualmente y el reintento del usuario recibe un **409 por duplicado** (riesgo no verificado en este informe).

## Riesgos hallados (documentación por descubrir)
1. **Abortar subida vs. 409 en reintento:** Si el cliente aborta la petición HTTP (por timeout) mientras el servidor sigue procesando el PDF, el documento puede crearse parcialmente o completamente en el backend. Cuando el usuario intenta reintentar, recibe un **409 Conflict** ("Ya existe un documento con el mismo checksum"). Esto significa que el timeout del cliente no cancela el procesamiento en el servidor; solo evita que el navegador espere la respuesta. *No verificado empíricamente, descrito como posibilidad.*
2. **Relación con otros timeouts aguas abajo:** El timeout del cliente (30 s) es el primero en la cadena, pero otros timeouts pueden cortar antes:
   - Traefik: middlewares `frontend-retry` y `frontend-cb` (circuit breaker) están configurados en `docker-compose.yml` pero sus timeoutss no fueron medibles aquí.
   - Nginx: No interviene en `/api` después de la issue #2 (confirmado: `nginx.conf` no tiene `client_max_body_size` ni proxy `/api`).
   - Orquestador/backend: No hay evidencia en `docs/api-contract.md`, `docs/openapi.json` ni `docs/contratos/` de un timeout interno menor a 30 s.

## Enlace en README
El documento está enlazado desde el README en la sección de configuración REQUEST_TIMEOUT_MS. El enlace es relativo verificado: `docs/timeout-pdf-9mb.md`.

## Decisión tomada
| Criterio | Resultado |
|---|---|
| Criterio 1 (medir PDF ~9 MB) | **NO VERIFICADO** — sin backend real accessible |
| Criterio 2 (¿supera 25 s?) | No aplicable (sin datos medidos) |
| Timeout actual | Se mantiene en **30000 ms (30 s)** |
| Justificación | Sin medición real, no procede ajuste según la issue |

## Comandos de reproducción (para cuándo haya backend disponible)
Si en el futuro hay un backend real accesible, el procedimiento de medición sería:

1. Colocar los PDFs en `tests/stress/pdfs/` o en carpeta temporal del sistema
2. Medir con `curl.exe -s -o <salida> -w`:
   ```
   curl.exe -s -o /tmp/response.txt -w "time_namelookup:%{time_namelookup}\ntime_connect:%{time_connect}\ntime_starttransfer:%{time_starttransfer}\ntime_total:%{time_total}\nsize_upload:%{size_upload}\nhttp_code:%{http_code}" -X POST -H "Content-Type: multipart/form-data" -F "file=@/tmp/pdf-stress/test-pdf-9mb-base.pdf" http://localhost:8000/api/v1/documents/upload
   ```
3. Medir con el cliente Node.js del repo, usando `performance.now()` alrededor de `apiClient.uploadDocument(file)` con timeout configurado muy alto.
4. Para cada una de N corridas (mínimo 5 + 1 de calentamiento), registrar `time_starttransfer` y `time_total`.
5. Calcular mínimo, mediana, máximo (sin contar el calentamiento).
6. Si el máximo supera 25 s, subir `REQUEST_TIMEOUT_MS` a al menos el doble del máximo medido, redondeado hacia arriba a múltiplo de 15 s.