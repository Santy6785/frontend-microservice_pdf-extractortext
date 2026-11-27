# Contrato de Registro Consul y Routing Externo (Issue #54)

Este documento especifica los datos de identificacion, puertos, healthcheck y metadata que la infraestructura central (Consul Catalog + Traefik en orchestrator #56) requiere para registrar y enrutar el microservicio **Front-End**.

---

## 1. Parametros de Registro en Consul

| Campo / Atributo | Valor Esperado | Descripcion |
| --- | --- | --- |
| **Nombre logico del servicio** | `frontend` | Identificador del servicio en Consul Catalog y router Traefik. |
| **Contenedor / Host interno** | `pdf-frontend` | Nombre del contenedor Docker en la red compartida (`shared_network`). |
| **Puerto interno HTTP** | `80` | Puerto estandar de Nginx expuesto en la red interna Docker (`expose: ["80"]`). |
| **Puerto de metrics internas** | `8081` | Puerto aislado para `stub_status` (`location = /metrics`), no enrutado por Traefik. |
| **Endpoint de healthcheck** | `/health` | Responde `HTTP 200 ok` con `{"status":"ok","service":"frontend"}`. |
| **Cabecera Host Nginx** | `server_name _;` | Acepta cualquier `Host` o IP de checkeador externo (Consul / Traefik). |

---

## 2. Definicion de Healthcheck para Consul

El endpoint `/health` es estatico, no genera logs de acceso (`access_log off`) y es independiente de las rutas internas bloqueadas (`/metrics`, `/trace`, `/nginx_status`, `/status`, `/pause`, `/resume`, `/shutdown`) que retornan `404` en el puerto `80`.

```json
b{  "service": {
    "name": "frontend",
    "port": 80,
    "tags": [
      "traefik.enable=true",
      "traefik.http.routers.frontend.rule=Host(`universidad.localhost`) && !PathPrefix(`/api`)",
      "traefik.http.routers.frontend.entrypoints=https",
      "traefik.http.routers.frontend.tls=true",
      "traefik.http.routers.frontend.priority=1",
      "traefik.http.services.frontend.loadbalancer.server.port=80"
    ],
    "check": {
      "id": "frontend-health",
      "name": "HTTP HEALTH on port 80",
      "http": "http://pdf-frontend:80/health",
      "interval": "10s",
      "timeout": "3s"
    }
  }
}
```

---

## 3. Separacion de Responsabilidades (Frontend vs Infraestructura)

- **Repositorio Frontend (este repo)**:
  - No declara labels ``traefik.*`` en `docker-compose.yml` para evitar que la simple presencia del contenedor en Docker local altere el enrutamiento gosbernado por Consul.
  - Expone la imagen Nginx lista para configuracion en runtime via `config.js` (`API_BASE_PATH` x `REQUEST_TIMEOUT_MS`) sin depender de rutas hardcodeadas.
- **Infraestructura Central (orchestrator #56)**:
  - Administra el catalogo de Consul, el provider `ConsulCatalog` de Traefik, certificados TLS, middlewares de resiliencia (retry/circuit breaker) y la red compartida `pdf-extractortext_pdf-network`.
