# Contrato de Enrutamiento Traefik (Frontend vs Orquestador)

Este documento define la arquitectura de enrutamiento y las etiquetas (labels) de Traefik para garantizar la correcta coexistencia entre el microservicio **Front-End** y el microservicio **Orquestador (Backend)** bajo el mismo dominio (`universidad.localhost`).

---

## 1. Contexto y Problemática (Issue #3)

Ambos microservicios se publican bajo el mismo host virtual: `universidad.localhost`.
- El **Front-End** sirve la interfaz gráfica de usuario y archivos estáticos (HTML, JS, CSS, assets) así como su endpoint `/health`.
- El **Orquestador** expone la API REST bajo `/api/v1/...` (documentos, procesamiento, healthcheck, etc.).

Si el router del Front-End utilizara una regla amplia como `Host(`universidad.localhost`)` sin exclusión y con prioridad igual o superior al orquestador, Traefik capturaría peticiones dirigidas a `/api/...` y las enviaría al contenedor Nginx del Front-End, causando fallos (404 o proxy no disponible).

---

## 2. Estrategia de Mitigación Robusta

Para blindar el enrutamiento ante fallos o variaciones de configuración, se aplica una doble protección:

1. **Exclusión explícita en la regla del Front-End:**
   - Regla: `Host(`universidad.localhost`) && !PathPrefix(`/api`)`
   - Impide de raíz que cualquier solicitud dirigida a `/api` o subrutas bajo `/api` ingrese al router del Front-End.
2. **Jerarquía explícita de prioridades:**
   - **Orquestador (`priority=20`):** Mayor precedencia para tráfico de API (`/api`).
   - **Front-End (`priority=1`):** Menor precedencia, actuando como router base por defecto para el resto de rutas web.

### Efecto Colateral de `!PathPrefix('/api')`
La regla `!PathPrefix('/api')` excluye todas las rutas cuyo prefijo comience por `/api`, tales como `/api`, `/api/v1/...`, `/api-docs` o `/apidocs`.
- **Evaluación:** Este comportamiento es **completamente aceptable y deseado**, ya que la documentación OpenAPI (Swagger/ReDoc) y los endpoints del sistema pertenecen al orquestador/backend, no al microservicio frontend estático.

---

## 3. Snippet para el `docker-compose.yml` del Orquestador

Para configurar el microservicio orquestador con el mismo host, entrypoint HTTPS, TLS y mayor prioridad, aplique las siguientes labels en la definición del servicio del orquestador en su respectivo `docker-compose.yml`:

```yaml
services:
  orquestador: # o el nombre del servicio en el repositorio del backend
    # ... configuraciones del servicio ...
    labels:
      - "traefik.enable=true"
      # Enrutamiento de todas las peticiones /api hacia el orquestador
      - "traefik.http.routers.orquestador.rule=Host(`universidad.localhost`) && PathPrefix(`/api`)"
      - "traefik.http.routers.orquestador.entrypoints=https"
      - "traefik.http.routers.orquestador.tls=true"
      # Prioridad alta para ganar sobre el router base del front
      - "traefik.http.routers.orquestador.priority=20"
      # Puerto interno del orquestador (ajustar segun corresponda, ej. 8000 para FastAPI/Uvicorn)
      - "traefik.http.services.orquestador.loadbalancer.server.port=8000"
```

> [!IMPORTANT]
> **SIN StripPrefix:** El router del orquestador **NO debe incluir** el middleware `StripPrefix`. La API REST ya implementa sus rutas nativamente con el prefijo `/api/v1` (por ejemplo, `/api/v1/health`, `/api/v1/documents/upload`). Quitar el prefijo provocaría que el backend reciba `/v1/...` o `/documents/...` y falle con error 404.

---

## 4. Resumen del Contrato de Enrutamiento

| Servicio | Router Traefik | Regla (`rule`) | Prioridad | Middleware StripPrefix | Destino |
|---|---|---|---|---|---|
| **Orquestador** | `orquestador` | `Host(`universidad.localhost`) && PathPrefix(`/api`)` | `20` | **NO** (preservar prefijo) | FastAPI (`:8000`) |
| **Front-End** | `frontend` | `Host(`universidad.localhost`) && !PathPrefix(`/api`)` | `1` | N/A | Nginx (`:80`) |

---

## 5. Comandos de Verificación con curl

Con ambos servicios y Traefik en ejecución:

```bash
# 1. Petición a la API (debe responder el orquestador)
curl -k -H "Host: universidad.localhost" https://localhost/api/v1/health

# 2. Petición a la UI (debe responder el front-end Nginx)
curl -k -i -H "Host: universidad.localhost" https://localhost/

# 3. Petición al healthcheck propio del frontend
curl -k -i -H "Host: universidad.localhost" https://localhost/health
```
