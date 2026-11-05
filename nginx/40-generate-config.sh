#!/bin/sh
set -e

# Validar sintaxis de la configuración de Nginx antes de iniciar
# Este paso impide que el contenedor inicie si nginx.conf tiene errores de sintaxis o de configuración
nginx -t > /dev/null 2>&1 || {
    echo "[Entrypoint] ERROR: La configuración de Nginx tiene errores de sintaxis o de configuración."
    echo "[Entrypoint] Ejecute 'nginx -t' manualmente en el contenedor para ver los detalles."
    exit 1
}

# Asignar valores por defecto a variables de entorno si no existen
export API_BASE_PATH="${API_BASE_PATH:-}"
export MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-10}"
export REQUEST_TIMEOUT_MS="${REQUEST_TIMEOUT_MS:-30000}"

# --- NUEVO: Leer y validar LOG_LEVEL y ACCESS_LOG ---

# Normalizar a minúsculas
export LOG_LEVEL="${LOG_LEVEL:-info}"
export ACCESS_LOG="${ACCESS_LOG:-on}"

LOG_LEVEL=$(printf '%s' "$LOG_LEVEL" | tr 'A-Z' 'a-z')
ACCESS_LOG=$(printf '%s' "$ACCESS_LOG" | tr 'A-Z' 'a-z')

# Lista blanca estricta
case "$LOG_LEVEL" in
    debug|info|warn|error) ; ;;
    *)
        LOG_LEVEL=info
        # Aviso a stderr (will be captured in docker logs)
        printf '[Entrypoint] WARNING: LOG_LEVEL=%s no válido, usando default INFO\\n' "$LOG_LEVEL" >&2
        ;;
esac

case "$ACCESS_LOG" in
    on|off) ; ;;
    *)
        ACCESS_LOG=on
        printf '[Entrypoint] WARNING: ACCESS_LOG=%s no válido, usando default ON\\n' "$ACCESS_LOG" >&2
        ;;
esac

# Mapeo de niveles LOG_LEVEL → error_log de nginx
# Se respeta el mapeo de la issue; debug requiere --with-debug
case "$LOG_LEVEL" in
    debug)
        # Verificar si el binario nginx soporta --with-debug
        if nginx -V 2>&1 | grep -q -- --with-debug; then
            NGINX_LEVEL=debug
        else
            NGINX_LEVEL=info
            printf '[Entrypoint] WARNING: LOG_LEVEL=debug no soportado en este binario nginx, usando info\\n' >&2
        fi
        ;;
    info) NGINX_LEVEL=info ;;
    warn) NGINX_LEVEL=warn ;;
    error) NGINX_LEVEL=error ;;
esac

# Generar fragmento de error_log
# VALOR: error_log /dev/stderr <nivel>;
# Si ACCESS_LOG=off, aún escribimos error_log con el nivel validado
cat > /etc/nginx/log_error.conf <<EOF
error_log /dev/stderr ${NGINX_LEVEL};
EOF

# Generar fragmento de access_log
# VALOR: access_log /dev/stdout json_fastapi; | access_log off;
if [ "$ACCESS_LOG" = "on" ]; then
    cat > /etc/nginx/log_access.conf <<EOF
access_log /dev/stdout json_fastapi;
EOF
else
    cat > /etc/nginx/log_access.conf <<EOF
access_log off;
EOF
fi

# Generar config.js desde config.template.js reemplazando únicamente las variables de configuración
if [ -f /usr/share/nginx/html/config.template.js ]; then
    envsubst '$API_BASE_PATH $MAX_UPLOAD_MB $REQUEST_TIMEOUT_MS' < /usr/share/nginx/html/config.template.js > /usr/share/nginx/html/config.js
    echo "[Entrypoint] Generado config.js con API_BASE_PATH='${API_BASE_PATH}', MAX_UPLOAD_MB=${MAX_UPLOAD_MB}, REQUEST_TIMEOUT_MS=${REQUEST_TIMEOUT_MS}"
fi

echo "[Entrypoint] Configuración de logging: LOG_LEVEL=${LOG_LEVEL}, ACCESS_LOG=${ACCESS_LOG}, error_log=Nginxlevel=${NGINX_LEVEL}"
# Generar config.js desde config.template.js sustituyendo únicamente las variables de configuración
if [ -f /usr/share/nginx/html/config.template.js ]; then
    envsubst '$API_BASE_PATH $MAX_UPLOAD_MB $REQUEST_TIMEOUT_MS' < /usr/share/nginx/html/config.template.js > /usr/share/nginx/html/config.js
    echo "[Entrypoint] Generado config.js con API_BASE_PATH='${API_BASE_PATH}', MAX_UPLOAD_MB=${MAX_UPLOAD_MB}, REQUEST_TIMEOUT_MS=${REQUEST_TIMEOUT_MS}"
fi
