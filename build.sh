#!/usr/bin/env bash
# ==============================================================================
# Script de Build y Verificación para el Microservicio Front-End
# Ejecuta linting + pruebas del front y SOLO si pasan construye la imagen Docker.
# ==============================================================================

set -euo pipefail

IMAGE_NAME="pdf-frontend"
IMAGE_TAG="0.2.0"

echo "========================================================"
echo " [1/3] Ejecutando análisis estático y linter (JS)"
echo "========================================================"
npm run lint

echo "========================================================"
echo " [2/3] Ejecutando tests unitarios, integración y sistema"
echo "========================================================"
npm test

echo "========================================================"
echo " [3/3] Pruebas aprobadas. Construyendo imagen Docker... "
echo "========================================================"
if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
        docker build -f Dockerfile -t "${IMAGE_NAME}:${IMAGE_TAG}" -t "${IMAGE_NAME}:latest" .
        echo "========================================================"
        echo " ✔ Build exitoso: ${IMAGE_NAME}:${IMAGE_TAG}"
        echo "========================================================"
    else
        echo "⚠ Docker CLI disponible pero el demonio Docker no está en ejecución."
        echo "  La verificación de código y tests pasó al 100%."
    fi
else
    echo "⚠ Docker no disponible en este entorno. Tests aprobados al 100%."
fi
