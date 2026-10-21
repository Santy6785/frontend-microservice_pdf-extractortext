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

* **Acceso directo HTTP:** `http://localhost:8080`
* **Acceso mediante Traefik:** `https://universidad.localhost`
* **Health Check:** `http://localhost:8080/health` (retorna `{"status":"ok","service":"frontend"}`)

### Opción B: Construcción directa con Docker

```bash
docker build -t pdf-frontend:0.2.0 -t pdf-frontend:latest .
docker run -d --name pdf-frontend -p 8080:80 --network pdf-extractortext_pdf-network pdf-frontend:0.2.0
```

---

## 4. Configuración en Runtime

El contenedor inyecta las variables de entorno en runtime mediante `envsubst` a través del script [`nginx/40-generate-config.sh`](file:///C:/Users/jerek/Desktop/Facultad/3ro/Desarrollo%20de%20Software/repo/frontend-microservice_pdf-extractortext/nginx/40-generate-config.sh):

| Variable | Descripción | Valor por Defecto |
|---|---|---|
| `API_BASE_PATH` | Prefijo o URL base de la API backend | `""` (Ruta relativa de mismo origen) |
| `MAX_UPLOAD_MB` | Tamaño máximo permitido de PDF en MB | `10` |
| `REQUEST_TIMEOUT_MS` | Timeout global para peticiones HTTP | `30000` (30 segundos) |

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

## 6. Contrato de API y OpenAPI Snapshot

> [!NOTE]
> Los archivos [`docs/api-contract.md`](file:///C:/Users/jerek/Desktop/Facultad/3ro/Desarrollo%20de%20Software/repo/frontend-microservice_pdf-extractortext/docs/api-contract.md) y [`docs/openapi.json`](file:///C:/Users/jerek/Desktop/Facultad/3ro/Desarrollo%20de%20Software/repo/frontend-microservice_pdf-extractortext/docs/openapi.json) incluidos en este repositorio son **snapshots** sincronizados para soporte del desarrollo, pruebas de integración con mocks y documentación técnica del equipo front-end.
> 
> **La fuente de verdad oficial del contrato y los esquemas es el repositorio del backend (monolito):**  
> 👉 [pdf-extractortext](https://github.com/Santy6785/pdf-extractortext)

---

## 7. Licencia

Este proyecto está bajo la licencia MIT. Consulta el archivo [`LICENSE`](file:///C:/Users/jerek/Desktop/Facultad/3ro/Desarrollo%20de%20Software/repo/frontend-microservice_pdf-extractortext/LICENSE) para más detalles.
