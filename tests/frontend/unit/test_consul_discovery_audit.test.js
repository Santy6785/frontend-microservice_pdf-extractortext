import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const compose = readFileSync('docker-compose.yml', 'utf8');
const nginxConf = readFileSync('Nginx/nginx.conf', 'utf8');
const dockerfile = readFileSync('Dockerfile', 'utf8');
const readme = readFileSync('README.md', 'utf8');

describe('Audit #54: Consul Discovery & External Routing Preparation', () => {
  it('1. Removes Traefik Docker labels from docker-compose.yml so Consul is the primary provider', () => {
    assert.ok(!compose.includes('traefik.enable'));
    assert.ok(!compose.includes('traefik.http.'));
    assert.ok(compose.includes('frontend:'));
    assert.ok(compose.includes('container_name: pdf-frontend'));
    assert.ok(compose.includes('"80"'));
  });

  it('2. Configures Nginx with catch-all server_name and independent /health endpoint on port 80', () => {
    assert.ok(nginxConf.includes('listen 80;'));
    assert.ok(nginxConf.includes('server_name _;'));
    assert.ok(nginxConf.includes('location = /health'));
    assert.ok(nginxConf.includes('"service":"frontend"'));
    assert.ok(dockerfile.includes('EXPOSE 80'));
    assert.ok(dockerfile.includes('http://127.0.0.1/health'));
  });

  it('3. Documents Consul service registration metadata, healthcheck and external routing contract', () => {
    assert.ok(existsSync('docs/consul-discovery-routing.md'));
    const consulDoc = readFileSync('docs/consul-discovery-routing.md', 'utf8');
    assert.ok(consulDoc.includes('`frontend`'));
    assert.ok(consulDoc.includes('`pdf-frontend`'));
    assert.ok(consulDoc.includes('`/health`'));
    assert.ok(consulDoc.includes('`80`'));
    assert.ok(readme.includes('consul-discovery-routing.md'));
  });
});
