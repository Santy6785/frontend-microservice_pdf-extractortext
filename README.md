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

### Opción B: Construcción directa con Docker

```bash
docker build -t pdf-frontend:0.2.0 -t pdf-frontend:latest .
docker run -d --name pdf-frontend --network pdf-extractortext_pdf-network pdf-frontend:0.2.0
```

---

## 4. Configuración en Runtime

El contenedor inyecta las variables de entorno en runtime mediante `envsubst` a través del script [`nginx/40-generate-config.sh`](file:///C:/Users/jerek/Desktop/Facultad/3ro/Desarrollo%20de%20Software/repo/frontend-microservice_pdf-extractortext/nginx/40-generate-config.sh):

| Variable | Descripción | Valor por Defecto |
|---|---|---|
| `API_BASE_PATH` | Prefijo o URL base de la API backend | `""` (Ruta relativa de mismo origen) |
| `MAX_UPLOAD_MB` | Tamaño máximo permitido de PDF en MB | `10` |
| `REQUEST_TIMEOUT_MS` | Timeout global para peticiones HTTP | `30000` (30 segundos) |
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

Para obtener el detalle completo de la excepción del front-end en endpoints operativos (/shutdown, /pause, /resume, /trace y métricas completas), consultar el [ADR-001](#adr-001-excepcion-del-front-end-en-endpoints-operativos-shutdown-pause-resume-trace-metricas-complejas) en `docs/decisiones.md`.

---

## 6. Contrato de API y OpenAPI Snapshot

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

## 6. Contrato de API y OpenAPI Snapshot

> [!NOTE]
> Los archivos [`docs/api-contract.md`](file:///C:/Users/jerek/Desktop/Facultad/3ro/Desarrollo%20de%20Software/repo/frontend-microservice_pdf-extractortext/docs/api-contract.md) y [`docs/openapi.json`](file:///C:/Users/jerek/Desktop/Facultad/3ro/Desarrollo%20de%20Software/repo/frontend-microservice_pdf-extractortext/docs/openapi.json) incluidos en este repositorio son **snapshots** sincronizados para soporte del desarrollo, pruebas de integración con mocks y documentación técnica del equipo front-end.
> 
> **La fuente de verdad oficial del contrato y los esquemas es el repositorio del backend (monolito):**  
> 👉 [pdf-extractortext](https://github.com/Santy6785/pdf-extractortext)

---

## 7. Licencia

Este proyecto está bajo la licencia MIT. Consulta el archivo [`LICENSE`](file:///C:/Users/jerek/Desktop/Facultad/3ro/Desarrollo%20de%20Software/repo/frontend-microservice_pdf-extractortext/LICENSE) para más detalles.
