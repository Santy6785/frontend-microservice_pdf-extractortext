#!/bin/sh
set -e

# Valores por defecto
export API_BASE_PATH="${API_BASE_PATH:-}"
export MAX_UPLOAD_MB="${MAX_UPLOAD_MB:-10}"
export REQUEST_TIMEOUT_MS="${REQUEST_TIMEOUT_MS:-30000}"
export LOG_LEVEL="${LOG_LEVEL:-info}"
export ACCESS_LOG="${ACCESS_LOG:-on}"

# Normalizar a minúsculas
LOG_LEVEL=$(printf '%s' "$LOG_LEVEL" | tr 'A-Z' 'a-z')
ACCESS_LOG=$(printf '%s' "$ACCESS_LOG" | tr 'A-Z' 'a-z')

# Lista blanca estricta para LOG_LEVEL
case "$LOG_LEVEL" in
  debug|info|warn|error) ;;
  *)
    printf '[Entrypoint] WARNING: LOG_LEVEL=%s no válido, usando default info\n' "$LOG_LEVEL" >&2
    LOG_LEVEL=info
    ;;
esac

# Lista blanca estricta para ACCESS_LOG
case "$ACCESS_LOG" in
  on|off) ;;
  *)
    printf '[Entrypoint] WARNING: ACCESS_LOG=%s no válido, usando default on\n' "$ACCESS_LOG" >&2
    ACCESS_LOG=on
    ;;
esac

# Mapeo LOG_LEVEL -> error_log de nginx (debug requiere --with-debug)
case "$LOG_LEVEL" in
  debug)
    if nginx -V 2>&1 | grep -q -- --with-debug; then
      NGINX_LEVEL=debug
    else
      NGINX_LEVEL=info
      printf '[Entrypoint] WARNING: LOG_LEVEL=debug no soportado en este binario nginx, usando info\n' >&2
    fi
    ;;
  info) NGINX_LEVEL=info ;;
  warn) NGINX_LEVEL=warn ;;
  error) NGINX_LEVEL=error ;;
esac

# Generar /etc/nginx/log_error.conf
cat > /etc/nginx/log_error.conf <<EOF
error_log /dev/stderr ${NGINX_LEVEL};
EOF

# Generar /etc/nginx/log_access.conf
if [ "$ACCESS_LOG" = "on" ]; then
  cat > /etc/nginx/log_access.conf <<EOF
access_log /dev/stdout json_fastapi;
EOF
else
  cat > /etc/nginx/log_access.conf <<EOF
access_log off;
EOF
fi

# Generar config.js desde config.template.js
if [ -f /usr/share/nginx/html/config.template.js ]; then
  envsubst '$API_BASE_PATH $MAX_UPLOAD_MB $REQUEST_TIMEOUT_MS' < /usr/share/nginx/html/config.template.js > /usr/share/nginx/html/config.js
  echo "[Entrypoint] Generado config.js con API_BASE_PATH='${API_BASE_PATH}', MAX_UPLOAD_MB=${MAX_UPLOAD_MB}, REQUEST_TIMEOUT_MS=${REQUEST_TIMEOUT_MS}"
fi

# Validar sintaxis de Nginx con la configuración final generada
nginx -t > /dev/null 2>&1 || {
  echo "[Entrypoint] ERROR: La configuración de Nginx tiene errores de sintaxis o de configuración." >&2
  nginx -t
  exit 1
}

echo "[Entrypoint] Configuración de logging: LOG_LEVEL=${LOG_LEVEL}, ACCESS_LOG=${ACCESS_LOG}, error_log=${NGINX_LEVEL}"