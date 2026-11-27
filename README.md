# PDF Extractor - Microservicio Front-End

Microservicio de interfaz de usuario para la plataforma de extracción y análisis de texto desde documentos PDF.

Construido con **JavaScript Vanilla moderno (ES Modules)** siguiendo el patrón arquitectónico **MVC (Modelo - Vista - Controlador)**, servido por un contenedor **Nginx sobre Alpine Linux** optimizado y sin privilegios, con configuración dinámica en runtime y resiliencia integrada con Traefik.

---

## 1. Arquitectura de la Aplicación

La aplicación web desacopla completamente la lógica de negocio, el renderizado de interfaz y la comunicación de red:

```
frontend/
├── index.html              # Vista principal (maquetación semántica y estilos CSS)
├── config.js               # Configuración activa en runtime
├── config.template.js      # Plantilla de variables para envsubst
└── js/
    ├── app.js              # Punto de entrada y orquestador del ciclo de vida
    ├── controller.js       # Controlador MVC: maneja eventos y coordina flujo
    ├── state.js            # Modelo/Estado observable reactivo (suscriptores)
    ├── view.js             # Capa de presentación y manipulación del DOM
    ├── api-client.js       # Cliente HTTP con timeouts, abort controller y backoff
    └── validator.js        # Validaciones de archivos (MIME, tamaño y extensión)
```

---

## 2. Requisitos Previos

- **Node.js:** v18+ (recomendado Node 20+ con soporte nativo de `--test`).
- **Docker & Docker Compose** (para empaquetado y ejecución contenerizada).
- **Red Docker Compartida:** El microservicio interactúa con el backend y el reverse proxy Traefik mediante una red externa de Docker.
  
  Por defecto, la red configurada en `docker-compose.yml` es:
  ```bash
  pdf-extractortext_pdf-network
  ```
  *(Es el mismo nombre que define el backend en su propio `docker-compose.yml`).*

  * **Si el backend ya está levantado:** la red ya existe y el frontend se unirá automáticamente.
  * **Si se levanta el frontend de forma aislada:** crear la red manualmente con:
    ```bash
    docker network create pdf-extractortext_pdf-network
    ```
  * **Si se utiliza un nombre de red personalizado:** configurar la variable `DOCKER_NETWORK_NAME` en un archivo `.env` (puedes basarte en `.env.example`):
    ```env
    DOCKER_NETWORK_NAME=mi-red-personalizada
    ```

---

## 3. Ejecución Local y Docker

### Opción A: Con Docker Compose (Recomendado)

Levanta el frontend conectado a la red compartida y con soporte para Traefik:

```bash
docker compose up --build -d
```

* **Acceso mediante Traefik:** `https://universidad.localhost`
* **Health Check (vía Traefik):** `https://universidad.localhost/health` (retorna `{"status":"ok","service":"frontend"}`)

> [!NOTE]
> **Sin puertos publicados en el host:** El servicio no expone puertos hacia el host (`ports` eliminado) para asegurar que todo el tráfico transite a través del reverse proxy Traefik, aprovechando el balanceo de carga, comprobaciones de salud y middlewares de resiliencia (retry y circuit breaker).
>
> **Resolución de nombres local (`universidad.localhost`):**  
> Si su sistema operativo o cliente HTTP de consola no resuelve dominios `.localhost` a `127.0.0.1` automáticamente (por ejemplo, en Windows PowerShell o curl sin resolvedor interno de navegador), agregue la siguiente entrada a su archivo `hosts` (`C:\Windows\System32\drivers\etc\hosts` en Windows o `/etc/hosts` en Linux/macOS):
> ```text
> 127.0.0.1 universidad.localhost
> ```
> Alternativamente, puede enviar la cabecera `Host` explícita:
> ```bash
> curl -k -i -H "Host: universidad.localhost" https://localhost/
> ```
>
> **Comprobación interna del contenedor (sin puerto publicado):**
> * Desde el propio contenedor:
>   ```bash
>   docker compose exec frontend wget -q -O - http://127.0.0.1/health
>   ```
> * Desde la red compartida Docker:
>   ```bash
>   docker run --rm --network pdf-extractortext_pdf-network curlimages/curl -s http://pdf-frontend/health
>   ```

#### Contrato de Enrutamiento y Prioridades en Traefik

Para garantizar la coexistencia sin colisiones en el dominio compartido `universidad.localhost`:
* **Front-End (`frontend`):** Atiende la UI (`/`) con regla `Host(`universidad.localhost`) && !PathPrefix(`/api`)` y prioridad baja explícita (`priority=1`), garantizando que ninguna llamada a `/api` sea absorbida por Nginx.
* **Orquestador (`orquestador`):** Debe atender el tráfico de API con regla `Host(`universidad.localhost`) && PathPrefix(`/api`)`, prioridad alta (`priority=20`) y **SIN middleware StripPrefix** (la API ya monta sus rutas bajo `/api/v1`).

Para el snippet completo y detalles de configuración, consulte [`docs/traefik-routing.md`](docs/traefik-routing.md).

### 3.1 URLs Internas y Puertos (Microservicio y Dependencias)

Todos los componentes se comunican dentro de la red externa compartida de Docker `pdf-extractortext_pdf-network` (configurable mediante `DOCKER_NETWORK_NAME`). Ningún contenedor publica puertos directamente al host; el acceso externo entra únicamente por **Traefik** (`https://universidad.localhost`).

| Componente / Rol | Servicio / Contenedor | Puerto Interno | URL Interna (Red Docker) | URL Externa (vía Traefik) | Propósito |
|---|---|---:|---|---|---|
| **Front-End (UI)** | `frontend` (`pdf-frontend`) | `80` | `http://pdf-frontend:80`<br>`http://pdf-frontend/health` | `https://universidad.localhost/`<br>`https://universidad.localhost/health` | Aplicación web estática (Nginx) y health check |
| **Front-End (Métricas)** | `frontend` (`pdf-frontend`) | `8081` | `http://pdf-frontend:8081/metrics` | *No expuesto externamente* | Métricas internas `stub_status` de Nginx (solo red Docker) |
| **Orquestador / Backend** *(dependencia)* | `orquestador` | `8000` | `http://orquestador:8000`<br>`http://orquestador:8000/api/v1/health` | `https://universidad.localhost/api/v1/...` | API REST de gestión y extracción de PDFs (`priority=20`, sin `StripPrefix`) |
| **Reverse Proxy** *(infraestructura)* | `traefik` | `443` (entrypoint `https`) | Red interna `pdf-extractortext_pdf-network` | `https://universidad.localhost` | Terminación TLS, balanceo, health checks y middlewares (`retry`, `circuitbreaker`) |

#### Detalle de consumo entre Front-End y Dependencias

- **Comunicación desde el navegador (mismo origen):** Por defecto (`API_BASE_PATH=""`), `ApiClient` utiliza rutas relativas (`/api/v1/documents/upload`, `/api/v1/documents/?skip=0&limit=20`, `/api/v1/documents/{id}`), por lo que el navegador envía las solicitudes a `https://universidad.localhost/api/v1/...` y **Traefik** las redirige internamente a `http://orquestador:8000`.
- **Comunicación interna de diagnóstico:** Dentro del propio contenedor del front-end, el `HEALTHCHECK` de Docker consulta `http://127.0.0.1/health` (puerto `80`), mientras que otros contenedores en `pdf-extractortext_pdf-network` pueden consultar `http://pdf-frontend:80/health` y `http://pdf-frontend:8081/metrics`.
- **Aislamiento de dependencias aguas abajo:** El microservicio Front-End no se comunica directamente con el extractor ni con la base de datos; toda interacción de negocio pasa exclusivamente por el **Orquestador** (`/api/v1/...`).

### Opción B: Construcción directa con Docker

```bash
docker build -t pdf-frontend:0.2.0 -t pdf-frontend:latest .
docker run -d --name pdf-frontend --network pdf-extractortext_pdf-network pdf-frontend:0.2.0
```


### 3.2 Orden de Arranque del Sistema Completo

Al desplegar la plataforma completa de microservicios sobre la red compartida `pdf-extractortext_pdf-network` (junto con el reverse proxy **Traefik**), los servicios deben iniciarse de forma escalonada de abajo hacia arriba según sus dependencias funcionales:

```text
1. Persistencia  →  2. Extractor  →  3. Orquestador  →  4. Front-End
```

| Orden | Microservicio / Capa | Rol y Dependencia | Verificación antes de continuar |
|---:|---|---|---|
| **1** | **Persistencia** | Base de datos y almacenamiento del sistema; crea/inicializa la red Docker compartida (`pdf-extractortext_pdf-network`) si aún no existe. | Contenedor saludable (`healthy`) y listo para aceptar conexiones. |
| **2** | **Extractor** | Servicio de extracción de texto desde archivos PDF; depende de la capa de persistencia. | Servicio levantado y pasando su health check interno. |
| **3** | **Orquestador** | API REST (`orquestador`, puerto interno `8000`) que coordina validación, extracción y persistencia, y registra su router `/api` en Traefik. | `GET http://orquestador:8000/api/v1/health` (o `https://universidad.localhost/api/v1/health`) responde `200 OK`. |
| **4** | **Front-End** | Interfaz web estática en Nginx (`frontend` / `pdf-frontend`, puerto interno `80`) que consume `/api/v1/...` a través de Traefik. | `GET http://pdf-frontend/health` (o `https://universidad.localhost/health`) responde `{"status":"ok","service":"frontend"}`. |

> [!TIP]
> **Nota de resiliencia en el arranque:** Si el **Front-End** se inicia antes de que el **Orquestador** esté disponible, la interfaz web carga con normalidad pero las operaciones de subida o consulta de documentos devolverán errores transitorios de proxy (`502`/`503`) hasta que el orquestador complete su inicialización.

---

## 4. Configuración en Runtime

El contenedor inyecta las variables de entorno en runtime mediante `envsubst` a través del script [`nginx/40-generate-config.sh`](nginx/40-generate-config.sh):

| Variable | Descripción | Valor por Defecto |
|---|---|---|
| `API_BASE_PATH` | Prefijo o URL base de la API backend | `""` (Ruta relativa de mismo origen) |
| `MAX_UPLOAD_MB` | Tamaño máximo permitido de PDF en MB | `10` |
| `REQUEST_TIMEOUT_MS` | Timeout global para peticiones HTTP | `45000` (45 segundos) |
| `LOG_LEVEL` | Nivel de log de error de Nginx | `info` |
| `ACCESS_LOG` | Activar logs de acceso en JSON a stdout | `on` |

| LOG_LEVEL | Efecto | Valores Válidos |
|---|---|---|
| `debug` | Nivel debug en `error_log /dev/stderr debug` (requiere nginx compilado con --with-debug) | debug, info, warn, error |
| `info` | Nivel info en `error_log /dev/stderr info` (default) | |
| `warn` | Nivel warn en `error_log /dev/stderr warn` | |
| `error` | Nivel error en `error_log /dev/stderr error` | |

| ACCESS_LOG | Efecto | Valores Válidos |
|---|---|---|
| `on` | `access_log /dev/stdout json_fastapi;` (una línea JSON por petición) | on, off |
| `off` | `access_log off;` (sin líneas de acceso, incluye /health) | |

---

## 4.5 Métricas internas (stub_status)

El microservicio front-end expone métricas básicas de Nginx mediante `stub_status` en el puerto **8081** dentro del contenedor. Este puerto **no se publica** en el host (consistent con issue #5), por lo que solo otros contenedores de la red Docker pueden acceder a él.

| Característica | Detalle |
|---|---|
| **Puerto** | 8081 (interno, no publicado) |
| **Endpoints** | `GET /metrics` → resumen de `stub_status` en texto plano<br>`GET /` → 404 |
| **Formato** | Texto plano (no es formato Prometheus)<br>Contiene: `Active connections`, `server accepts handled requests`, `Reading/Writing/Waiting` |
| **Acceso** | Solo desde contenedores de la red `pdf-extractortext_pdf-network`<br>Ejemplo: `curl http://pdf-frontend:8081/metrics` |
| **Restricciones** | `access_log off` en este server block<br>No enrutado por Traefik (solo puerto 80)<br>El campo usa `$uri` (NUNCA `$request_uri`) |

*Salida de ejemplo de `curl http://pdf-frontend:8081/metrics`:*

```
Active connections: 1
  server accepts handled requests: 10 10 10
  Reading: 0 Writing: 1 Waiting: 0
```

*Nota:* Si se requiere formato Prometheus en el futuro, se debe añadir un exportador separado. Las métricas de `stub_status` son de uso interno para diagnóstico y monitoreo básico de la infraestructura Docker.

---

## 5. Pruebas y Control de Calidad

El proyecto utiliza el test runner nativo de Node.js (`node --test`), sin dependencias pesadas de terceros:

```bash
# Ejecutar linter estático de sintaxis JS
npm run lint

# Ejecutar toda la suite de pruebas
npm test

# Ejecutar por niveles específicos
npm run test:unit           # Pruebas unitarias (state, validator, controller, api-client)
npm run test:integration    # Integración MVC contra servidor mock OpenAPI
npm run test:system         # Simulación de flujo E2E en navegador
npm run test:e2e            # Prueba E2E real contra https://universidad.localhost (requiere stack completo levantado)
```

### Script de Build y Validación Completa
Para ejecutar linting, todas las pruebas y construir la imagen Docker en un solo paso:
* En Linux / macOS / Bash:
  ```bash
  ./build.sh
  ```
* En Windows PowerShell:
  ```powershell
  .\build.ps1
  ```

---

## 6. Decisiones Arquitectónicas

Para obtener el detalle completo de la excepción del front-end en endpoints operativos (/shutdown, /pause, /resume, /trace y métricas completas), consultar el [ADR-001](docs/decisiones.md) (excepcion de endpoints operativos /trace, /pause, /resume, /shutdown en servidor estatico Nginx y apagado seguro via SIGQUIT) en `docs/decisiones.md`.

---

## 7. Política de Seguridad de Contenidos (CSP)

> **[!IMPORTANTE]**
> Se ha añadido una Política de Seguridad de Contenidos (CSP) en la cabecera HTTP `Content-Security-Policy` mediante configuración en `nginx/nginx.conf`. La política es:

> ```
> default-src 'self';
> script-src 'self' https://cdn.tailwindcss.com;
> style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
> font-src 'self' https://fonts.gstatic.com;
> img-src 'self' data:;
> connect-src 'self';
> ```

> **Justificación:** Defensa en profundidad al ser el front-end un sitio estático servido por Nginx sin ejecución de PHP u otros runtimes. Los scripts y estilos provienen de orígenes confiables (`self`, CDN de Tailwind, Google Fonts). No se usa `'unsafe-eval'`. La directiva `'unsafe-inline'` en `style-src` es necesaria para los estilos inline del HTML (ver `frontend/index.html`); no hay `'unsafe-inline'` en `script-src`.

> **Rutas afectadas:** La cabecera CSP aparece en todas las respuestas de Nginx: `/`, `/index.html`, `/config.js`, `/health`, archivos estáticos y respuestas 404 (por la directiva `always` en `add_header`).

> **Cómo ajustarla:** Si se añaden nuevos recursos al front (scripts, estilos, fuentes), modificar la cadena de la CSP en `nginx/nginx.conf`. Para sustituir `'unsafe-inline'` en `style-src` por un hash `sha384`, se debe extraer el contenido del `<style>` inline a un archivo `.css` propio y añadir `sha384-<hash>` a la directiva `style-src`. No se han añadido orígenes de terceros no utilizados.

---

## 8. Contrato de API y OpenAPI Snapshot

> [!NOTE]
> Los archivos [`docs/api-contract.md`](docs/api-contract.md) y [`docs/openapi.json`](docs/openapi.json) incluidos en este repositorio son **snapshots** sincronizados para soporte del desarrollo, pruebas de integración con mocks y documentación técnica del equipo front-end.
> 
> **La fuente de verdad oficial del contrato y los esquemas es el repositorio del backend (monolito):**  
> 👉 [pdf-extractortext](https://github.com/Santy6785/pdf-extractortext)

---

## 9. Licencia

Este proyecto está bajo la licencia MIT. Consulta el archivo [`LICENSE`](LICENSE) para más detalles.

## Escaneo de Seguridad y Vulnerabilidades (Grype)

El repositorio incluye un pipeline automatizado en `.github/workflows/security-grype.yml` que construye la imagen final de Nginx y la audita con **Grype** bajo la politica definida en `.grype.yaml`:

- **Politica de severidad**: El pipeline falla (`fail-build: true`) si detecta vulnerabilidades de severidad `HIGH` o `CRITICAL` con parche disponible (`only-fixed: true`).
- **Trazabilidad y excepciones**: Cualquier excepcion requiere justificacion tecnica y fecha de vencimiento (`expires: "YYYY-MM-DD"`) en `.grype.yaml`.
- **Artefactos**: Cada ejecucion publica los reportes completos en formato **JSON** y **SARIF** como *artifacts* del workflow (`grype-security-reports-<run>`).
- **Dependencias**: El frontend es estatico (HTML/CSS/Vanilla JS sin paquetes runtime en `package.json`) y la imagen base `nginx:alpine` ejecuta `apk upgrade --no-cache` durante el build.

### Ejecucion local del escaneo

```bash
# 1. Construir la imagen final
docker build -t pdf-extractor-frontend:local .

# 2. Escanear la imagen con Grype usando la politica del repositorio (sin instalar binarios locales)
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$(pwd)/.grype.yaml:/.grype.yaml:ro" \
  anchore/grype:latest docker:pdf-extractor-frontend:local -c /.grype.yaml

# 3. Exportar reportes JSON y SARIF localmente
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$(pwd)/.grype.yaml:/.grype.yaml:ro" \
  anchore/grype:latest docker:pdf-extractor-frontend:local -c /.grype.yaml -o json > grype-report.json
```
