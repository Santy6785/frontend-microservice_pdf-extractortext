# Dockerfile para el Microservicio Front-End
# Nginx sirviendo contenido estático con configuración en runtime vía envsubst
FROM nginx:alpine

# Variables de entorno con valores por defecto
ENV LOG_LEVEL=info
ENV ACCESS_LOG=on

# Copiar la configuración global optimizada de Nginx (con logs JSON y /health)
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Copiar script de inicialización para generar config.js con envsubst antes de iniciar Nginx
COPY nginx/40-generate-config.sh /docker-entrypoint.d/40-generate-config.sh
RUN chmod +x /docker-entrypoint.d/40-generate-config.sh

# --- NUEVO: Crear fragmentos por defecto de log_error.conf y log_access.conf
# Así nginx -t funciona aunque el script aún no se haya ejecutado en el contenedor
RUN echo 'error_log /dev/stderr info;' > /etc/nginx/log_error.conf && \
    echo 'access_log /dev/stdout json_fastapi;' > /etc/nginx/log_access.conf

# Copiar archivos estáticos del frontend
COPY frontend/ /usr/share/nginx/html/

# Ajustar permisos para permitir ejecución segura con usuario sin privilegios
RUN touch /tmp/nginx.pid && \
    chown -R nginx:nginx /tmp/nginx.pid /var/cache/nginx /var/run /usr/share/nginx/html

# Exponer el puerto HTTP
EXPOSE 80

# Health check contra el endpoint /health nativo de Nginx
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/health || exit 1

# Parada segura con SIGQUIT para finalizar conexiones en vuelo
STOPSIGNAL SIGQUIT

# Ejecutar como usuario sin privilegios
USER nginx

# Iniciar servidor Nginx
CMD ["nginx", "-g", "daemon off;"]
