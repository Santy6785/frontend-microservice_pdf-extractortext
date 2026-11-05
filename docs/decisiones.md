# ADR-001: Excepción del Front-end en Endpoints Operativos (/shutdown, /pause, /resume, /trace, Métricas Complejas)

**Estado:** Propuesta  
**Fecha:** 2026-11-04  
**Alcance:** Microservicio front-end (Nginx sirviendo UI estática)

## Contexto

Las especificaciones del trabajo exigen que cada microservicio implemente los siguientes Capos de Observabilidad y Control de Ciclo de Vida:

- **Logs configurables:** input, error, debug, warn, sin información sensible
- **Trace:** última petición/respuesta
- **Métricas:** contadores, histogramas en tiempo real
- **/health por capas:** salud a nivel de servicio
- **Control de ciclo de vida:** /shutdown, /pause, /resume para finalización segura

El front-end es un sitio estático servido por Nginx en un contenedor independiente. La lógica de negocio, las trazas y las métricas completas viven en el backend FastAPI. No se agregó un runtime adicional (por ejemplo, FastAPI + StaticFiles) al contenedor front-end para cumplir con estos requisitos.

### Evidencia de lo que hoy implementa el front-end

| Requisito | Implementación actual | Evidencia |
|---|---|---|
| **/health** | Endpoint estático Nginx | `nginx/nginx.conf:62-66` define `location = /health` que retorna `200 OK` con `Content-Type: application/json` y cuerpo `{"status":"ok","service":"frontend"}` |
| **Logs JSON** | Logs configurables con esquema FastAPI | `nginx/nginx.conf:13-22` define `log_format json_fastapi` registrando `method`, `$uri`, `status`, `request_time`; `error_log /dev/stderr <nivel configurable>`; access_log con esquema JSON cuando ACCESS_LOG=on; no se registran nombres de archivo ni contenido de PDF |
| **Apagado seguro** | SIGQUIT + grace period | `docker-compose.yml:12` `stop_signal: SIGQUIT`, `docker-compose.yml:13` `stop_grace_period: 10s`; Dockerfile `STOPSIGNAL SIGQUIT`; Nginx al recibir SIGQUIT realiza cierre ordenado (deja de aceptar conexiones nuevas, termina las en curso) |
| **/trace** | No implementado en Nginx | No existe en `nginx/nginx.conf` ni en la configuración del contenedor |
| **Métricas completas** | No implementado en Nginx | No hay contadores/objetivos de Prometheus expuestos en el front |
| **/pause** | No implementado | No existe en la configuración del front |
| **/resume** | No implementado | No existe en la configuración del front |
| **/shutdown** | No implementado en Nginx | No existe endpoint HTTP; el apagado se gestiona vía señal Docker (`docker stop`) |

## Decisión

El microservicio front-end es la **excepción** para los endpoints `/shutdown`, `/pause`, `/resume`, `/trace` y **métricas completas**. Estos endpoints están diseñados para aplicaciones con estado y lógica de negocio (FastAPI), no para un servidor de archivos estáticos.

**Lo que el front SÍ cumple (con evidencia):**

- `/health` estático mediante Nginx (`nginx/nginx.conf:62-66`) — retorna JSON `{"status":"ok","service":"frontend"}` con `200 OK` y `Content-Type: application/json`
- **Logs JSON estructurados** (`nginx/nginx.conf:13-22`) — registra método, URI, código de estado, latencia y bytes enviados; nivel de error configurable (`error_log /dev/stderr warn`); por diseño omite datos sensibles (cuerpo de PDFs, nombres de archivo en query strings)
- **Apagado seguro** (`docker-compose.yml:12-13`, `Dockerfile:27`) — `stop_signal: SIGQUIT`, `stop_grace_period: 10s`; `STOPSIGNAL SIGQUIT` en Dockerfile; Nginx al recibir SIGQUIT espera a que terminen las conexiones en vuelo antes de apagarse, cumpliendo el requisito de "finalización segura"

## Justificación

1. **Nginx es un servidor de archivos estáticos sin estado de aplicación:** No hay procesos de negocio que pausar o reanudar, ni traces de request empresariales que capturar. Estos endpoints son inútiles para un caso de uso puramente de presentación.

2. **Evitar superficie de ataque y tamaño de imagen:** Añadir FastAPI + StaticFiles u otro runtime (Python, gunicorn, etc.) al contenedor front-end aumentaría:
   - El tamaño de la imagen (de ~25MB con `nginx:alpine` a >150MB con Python runtime)
   - Las dependencias (Python, pip, librerías de tracing)
   - El vector de ataque (módulos Python adicionales, server framework)
   - La complejidad de mantenimiento (builds, CVEs en dependencias)

3. **La observabilidad de negocio ya está en el backend FastAPI:** El contrato OpenAPI (`docs/api-contract.md`) y `docs/openapi.json` ya exponen `/health`, códigos de estado, rate limiting y metadatos de operación. El front no necesita duplicar estos endpoints.

4. **Traefik ya provee métricas y tracing a nivel de infraestructura:** El router Traefik recopila `NetworkErrorRatio`, `ResponseCodeRatio`, y puede exportar métricas Prometheus. El health check de Traefik (`traefik.http.services.frontend.loadbalancer.healthcheck.path=/health`) ya verifica la disponibilidad del front.

5. **El apagado seguro ya está resuelto por la señal SIGQUIT:** A diferencia de SIGTERM/SIGINT que provocan cierre rápido, SIGQUIT hace que Nginx termine conexiones en vuelo de manera ordenada. El `stop_grace_period: 10s` en `docker-compose.yml` da suficiente tiempo para este proceso.

## Alternativas Consideradas

### Alternativa 1: Servir el front con FastAPI + StaticFiles

**Ventajas:**
- Cumplimiento literal de las especificaciones: todos los microservicios tendrían `/trace`, `/metrics`, `/pause`, `/resume`, `/shutdown` uniformes.
- Misma imagen/container para todos los servicios, facilitando la estandarización.
- Los endpoints de operativa funcionarían sin necesidad de un sidecar o infraestructura adicional.

**Desventajas:**
- Aumento significativo del tamaño de la imagen Docker (nginx:alpine ~25MB vs Python + Uvicorn + StaticFiles >150MB).
- Dependencias adicionales (Python runtime, gunicorn, módulos de tracing) añaden superficie de ataque.
- Builds más lentos y configuración de `requirements.txt` adicional.
- Los logs JSON y el formato actual de acceso Nginx tendrían que reemplazarse o complementarse con formateo de logs Python, rompiendo con la política "sin datos sensibles" ya establecida.
- El salud check `/health` ya existente en Nginx sería redundante con el del framework FastAPI.

**Por qué se descartó:** El objetivo del microservio front-end es servir una UI estática con mínima sobrecarga y máxima seguridad. Añadir un runtime Python contradice los principios de minimalismo y seguridad del proyecto.

### Alternativa 2: Módulos adicionales de Nginx (stub_status, etc.)

**Ventajas:**
- Mantener Nginx como único proceso sin añadir runtimes de alto nivel.
- `stub_status` expone algunas métricas básicas (peticiones activas, handled, total).
- Configuración nativa de Nginx, sin cambios en el Dockerfile.

**Desventajas:**
- `stub_status` no ofrece trazas (`/trace`) ni control de pausa/reanudación (`/pause`, `/resume`).
- Las métricas que expone son de nivel de conexiones TCP, no de negocio.
- Requiere habilitar `stub_status` en la directiva `server` y acceder a `/status` — no cumple el requisito de "métricas completas" ni de trace.
- Aún no resuelve `/shutdown`, `/pause`, `/resume` que requieren control de ciclo de vida de aplicación.

**Por qué se descartó:** No cubre el conjunto completo de endpoints requeridos por las especificaciones. Queda en el mismo caso de excepción que la decisión actual.

## Cómo se cumple el Apagado Seguro

El contenedor front-end garantiza un apagado ordenado mediante la señal `SIGQUIT`, configurada en tres lugares:

1. **`docker-compose.yml` línea 12:** `stop_signal: SIGQUIT`
2. **`docker-compose.yml` línea 13:** `stop_grace_period: 10s`
3. **`Dockerfile` línea 27:** `STOPSIGNAL SIGQUIT`

Cuando `docker stop` envía SIGQUIT al proceso (PID 1, que es Nginx):
- Nginx deja de aceptar conexiones entrantes nuevas
- Completa el procesamiento de las conexiones existentes (requests en curso terminan)
- Una vez drenado, Nginx sale con código 0
- Si transcurre `stop_grace_period: 10s` sin que Nginx se detenga, Docker enviará SIGKILL como fallback

Esto se verificó en la issue #6: ambos tiempos de medición fueron ~0.6-0.7 segundos, bien por debajo del umbral de 10 segundos, y el código de salida fue 0 (no 137 = SIGKILL).

## Consecuencias y Limitaciones

| Característica | Estado en Front-end | Impacto |
|---|---|---|
| `/health` | ✅ Implementado (Nginx) | Cumple requisito de health check a nivel de servicio |
| `/trace` | ❌ No implementado | La evaluación de trazas se debe hacer sobre el backend FastAPI |
| **Métricas completas** | ❌ No implementado | No hay contadores/objetivos expuestos en el front; usar métricas de Traefik/Prometheus a nivel de infraestructura |
| **/pause** | ❌ No implementado | No aplica para servidor de archivos estáticos |
| **/resume** | ❌ No implementado | No aplica para servidor de archivos estáticos |
| **/shutdown** | ✅ Controlado por señal Docker/SIGQUIT | El apagado seguro está garantizado; no hay endpoint HTTP |

**Limitaciones identificadas:**
- Si un caso de uso exige literalmente `/trace`, `/metrics` completos, `/pause` o `/resume` en el front-end, la alternativa de servir la UI con FastAPI + StaticFiles (Alternativa 1 de la sección anterior) queda disponible pero con el costo de aumento de imagen y dependencias.
- Los logs JSON del front omiten propositadamente contenido de PDFs y datos sensibles, alineándose con la política de privacidad, pero también significan que no hay trazas de petición de archivo en los logs del front.

## Referencias

- [`docs/frontend-parity.md`] Sección "3. Observabilidad del Microservicio Front" (línea 174-175) — reconocimiento de la excepción
- [`docs/api-contract.md`] — contrato OpenAPI del backend FastAPI, define `/api/v1/health` y endpoints de negocio
- [`docs/openapi.json`] — snapshot OpenAPI 3.1.0 del backend; no contiene rutas `/trace`, `/metrics`, `/pause`, `/resume`, `/shutdown`
- [`docker-compose.yml`] líneas 12-13 — `stop_signal: SIGQUIT`, `stop_grace_period: 10s`
- [`Dockerfile`] línea 27 — `STOPSIGNAL SIGQUIT`
- [`nginx/nginx.conf`] líneas 62-66 — `/health` location block
- [`nginx/nginx.conf`] líneas 13-22 — `log_format json_fastapi` y `include /etc/nginx/log_access.conf` — formato FastAPI con `$uri` (NUNCA `$request_uri`), `escape=json`; `include /etc/nginx/log_error.conf` con nivel configurable
- Issue #2: "Sin `location /api/` ni `proxy_pass` en nginx" — garantiza aislamiento de rutas
- Issue #3: "Reglas routers Traefik con `!PathPrefix` y prioridad baja" — enruteo correcto de tráfico
- Issue #5: "Sin `ports:` en el servicio front" — exposición solo mediante `expose: ["80"]`
- Issue #6: "Verificación funcional con Docker" — incluye medición de `docker stop` tiempos
- Especificaciones del trabajo: "cada microservicio tenga: logs configurables, trace, métricas, /health por capas, /shutdown /pause /resume"