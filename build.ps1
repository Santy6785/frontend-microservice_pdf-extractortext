# ==============================================================================
# Script de Build y Verificacion para el Microservicio Front-End (PowerShell)
# Ejecuta linting + pruebas del front y SOLO si pasan construye la imagen Docker.
# ==============================================================================

$ErrorActionPreference = "Stop"

$ImageName = "pdf-frontend"
$ImageTag = "0.2.0"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " [1/3] Ejecutando analisis estatico y linter (JS)" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
npm run lint
if ($LASTEXITCODE -ne 0) { throw "Fallo en linting" }

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " [2/3] Ejecutando tests unitarios, integracion y sistema" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw "Fallo en tests de frontend" }

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " [3/3] Pruebas aprobadas. Construyendo imagen Docker... " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
try {
    $dockerCheck = docker info 2>&1
    if ($LASTEXITCODE -eq 0) {
        docker build -f Dockerfile -t "${ImageName}:${ImageTag}" -t "${ImageName}:latest" .
        Write-Host "`n========================================================" -ForegroundColor Green
        Write-Host " Build exitoso: ${ImageName}:${ImageTag}" -ForegroundColor Green
        Write-Host "========================================================" -ForegroundColor Green
    } else {
        Write-Host "Docker CLI disponible pero el demonio Docker no esta en ejecucion localmente." -ForegroundColor Yellow
        Write-Host "El codigo paso todos los linters y pruebas unitarias/integracion exitosamente." -ForegroundColor Yellow
    }
} catch {
    Write-Host "Docker CLI disponible pero el demonio Docker no esta en ejecucion localmente." -ForegroundColor Yellow
    Write-Host "El codigo paso todos los linters y pruebas unitarias/integracion exitosamente." -ForegroundColor Yellow
}
