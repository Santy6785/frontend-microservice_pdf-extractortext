import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const dockerfile = readFileSync('Dockerfile', 'utf8');
const dockerignore = readFileSync('.dockerignore', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const readme = readFileSync('README.md', 'utf8');

describe('Audit #53: Grype CI Pipeline, Severity Policy & Nginx Image Hygiene', () => {
  it('1. Defines Grype CI workflow with JSON and SARIF outputs and artifact upload', () => {
    assert.ok(existsSync('.github/workflows/security-grype.yml'));
    const workflow = readFileSync('.github/workflows/security-grype.yml', 'utf8');
    assert.ok(workflow.includes('anchore/grype:latest'));
    assert.ok(workflow.includes('-c /.grype.yaml'));
    assert.ok(workflow.includes('-o sarif'));
    assert.ok(workflow.includes('-o json'));
    assert.ok(workflow.includes('actions/upload-artifact@v4'));
    assert.ok(workflow.includes('--fail-on high'));
  });

  it('2. Defines severity policy and expiration-based exception schema in .grype.yaml', () => {
    assert.ok(existsSync('.grype.yaml'));
    const grypePolicy = readFileSync('.grype.yaml', 'utf8');
    assert.ok(grypePolicy.includes('fail-on-severity: high'));
    assert.ok(grypePolicy.includes('only-fixed: true'));
    assert.ok(grypePolicy.includes('expires:'));
    assert.ok(grypePolicy.includes('ignore:'));
  });

  it('3. Applies Alpine security upgrades and keeps zero external runtime npm dependencies', () => {
    assert.ok(dockerfile.includes('apk upgrade --no-cache'));
    assert.equal(packageJson.dependencies, undefined);
    assert.equal(packageJson.devDependencies, undefined);
  });

  it('4. Excludes secrets, keys, CI workflows and scan reports from Docker build context', () => {
    assert.ok(dockerignore.includes('.env'));
    assert.ok(dockerignore.includes('*.pem'));
    assert.ok(dockerignore.includes('*.key'));
    assert.ok(dockerignore.includes('.github/'));
    assert.ok(dockerignore.includes('reports/'));
  });

  it('5. Documents local Grype scanning commands and policy in README.md', () => {
    assert.ok(readme.includes('Escaneo de Seguridad y Vulnerabilidades (Grype)'));
    assert.ok(readme.includes('anchore/grype'));
    assert.ok(readme.includes('.grype.yaml'));
  });
});
