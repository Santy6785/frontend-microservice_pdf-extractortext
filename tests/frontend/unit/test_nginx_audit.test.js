import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const nginxConf = readFileSync('nginx/nginx.conf', 'utf8');
const entrypointScript = readFileSync('nginx/40-generate-config.sh', 'utf8');
const composeFile = readFileSync('docker-compose.yml', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const decisiones = readFileSync('docs/decisiones.md', 'utf8');

describe('Audit #52: Nginx Static Server, Health, Logs, Security & Lifecycle', () => {
  it('1. Confirms static Nginx architecture without FastAPI/Python runtime', () => {
    assert.match(dockerfile, /^FROM\s+nginx:alpine/m);
    assert.doesNotMatch(dockerfile, /uvicorn|python|pip\s+install|requirements\.txt/i);
    assert.ok(dockerfile.includes('COPY frontend/ /usr/share/nginx/html/'));
  });

  it('2. Validates /health endpoint and Docker HEALTHCHECK', () => {
    assert.ok(nginxConf.includes('location = /health'));
    assert.ok(nginxConf.includes('return 200 \'{"status":"ok","service":"frontend"}\';'));
    assert.ok(dockerfile.includes('http://127.0.0.1/health'));
  });

  it('3. Blocks /metrics, /trace and status endpoints on public port 80 and isolates stub_status on internal 8081', () => {
    assert.ok(nginxConf.includes('location ~ ^/(metrics|trace|nginx_status|status|pause|resume|shutdown)$'));
    assert.ok(nginxConf.includes('listen 8081;'));
    assert.ok(nginxConf.includes('stub_status;'));
    assert.doesNotMatch(composeFile, /^\s*ports:/m);
  });

  it('4. Documents why trace/pause/resume/shutdown do not apply as static endpoints and configures SIGQUIT graceful stop', () => {
    assert.match(dockerfile, /STOPSIGNAL\s+SIGQUIT/);
    assert.ok(nginxConf.includes('worker_shutdown_timeout 5s;'));
    assert.match(composeFile, /stop_signal:\s*SIGQUIT/);
    assert.match(composeFile, /stop_grace_period:\s*10s/);
    assert.ok(decisiones.includes('ADR-001'));
    assert.ok(readme.includes('ADR-001'));
    assert.ok(readme.includes('SIGQUIT'));
  });

  it('5. Configures structured stdout/stderr logs without sensitive data or query strings', () => {
    assert.ok(nginxConf.includes('server_tokens off;'));
    assert.ok(nginxConf.includes('log_format json_fastapi'));
    assert.ok(nginxConf.includes('\\"path\\":\\"$uri\\"'));
    assert.doesNotMatch(nginxConf, /\$request_uri|\$args|\$query_string|\$request_body/);
    assert.ok(entrypointScript.includes('error_log /dev/stderr'));
    assert.ok(entrypointScript.includes('access_log /dev/stdout json_fastapi;'));
  });

  it('6. Configures security headers, CSP, static caching and runtime config', () => {
    assert.ok(nginxConf.includes('X-Frame-Options "SAMEORIGIN" always'));
    assert.ok(nginxConf.includes('X-Content-Type-Options "nosniff" always'));
    assert.ok(nginxConf.includes('Referrer-Policy "strict-origin-when-cross-origin" always'));
    assert.ok(nginxConf.includes('Permissions-Policy'));
    assert.ok(nginxConf.includes('Content-Security-Policy'));
    assert.ok(nginxConf.includes('Cache-Control "no-cache, no-store, must-revalidate" always'));
    assert.ok(nginxConf.includes('Cache-Control "public, max-age=3600, no-transform" always'));
    assert.ok(entrypointScript.includes("envsubst '$API_BASE_PATH $MAX_UPLOAD_MB $REQUEST_TIMEOUT_MS'"));
  });
});