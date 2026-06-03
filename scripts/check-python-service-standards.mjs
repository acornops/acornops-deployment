import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workspaceRoot = process.env.ACORNOPS_WORKSPACE_ROOT
  ? path.resolve(process.env.ACORNOPS_WORKSPACE_ROOT)
  : path.resolve(root, '..');

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function read(absolutePath) {
  return readFileSync(absolutePath, 'utf8');
}

function expectIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    fail(`${message}: missing ${needle}`);
  }
}

function expectNotIncludes(content, needle, message) {
  if (content.includes(needle)) {
    fail(`${message}: forbidden ${needle}`);
  }
}

function expectFile(repoName, repoPath, relativePath) {
  const absolutePath = path.join(repoPath, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`${repoName}: missing ${relativePath}`);
    return null;
  }
  return absolutePath;
}

const services = [
  {
    name: 'llm-gateway',
    repoDir: 'llm-gateway',
    dockerfile: 'deployments/Dockerfile.gateway',
    ciFile: '.github/workflows/ci.yaml',
    firstParty: 'app'
  },
  {
    name: 'execution-engine',
    repoDir: 'execution-engine',
    dockerfile: 'Dockerfile',
    ciFile: '.github/workflows/ci.yml',
    firstParty: 'execution_engine'
  }
];

let checkedAnyService = false;

for (const service of services) {
  const repoPath = path.join(workspaceRoot, service.repoDir);
  if (!existsSync(repoPath)) {
    warn(`Skipping ${service.name}; sibling repo not found at ${repoPath}`);
    continue;
  }

  checkedAnyService = true;

  const pyprojectPath = expectFile(service.name, repoPath, 'pyproject.toml');
  const constraintsPath = expectFile(service.name, repoPath, 'constraints.txt');
  const lockPath = expectFile(service.name, repoPath, 'requirements.lock');
  const dockerfilePath = expectFile(service.name, repoPath, service.dockerfile);
  const ciPath = expectFile(service.name, repoPath, service.ciFile);
  const dockerignorePath = expectFile(service.name, repoPath, '.dockerignore');

  if (pyprojectPath) {
    const pyproject = read(pyprojectPath);
    expectIncludes(pyproject, '[tool.ruff]', `${service.name}: pyproject must configure Ruff`);
    expectIncludes(pyproject, 'line-length = 120', `${service.name}: Ruff line length must match platform standard`);
    expectIncludes(pyproject, 'target-version = "py312"', `${service.name}: Ruff target version must match runtime Python`);
    expectIncludes(pyproject, 'select = ["E", "F", "I", "W"]', `${service.name}: Ruff selected rules must match platform standard`);
    expectIncludes(
      pyproject,
      `known-first-party = ["${service.firstParty}"]`,
      `${service.name}: Ruff import grouping must declare the service package`
    );
  }

  if (lockPath) {
    const lock = read(lockPath);
    expectIncludes(lock, '--hash=sha256:', `${service.name}: requirements.lock must be hash locked`);
    expectIncludes(lock, 'pip-compile', `${service.name}: requirements.lock should document pip-compile provenance`);
  }

  if (constraintsPath) {
    const constraints = read(constraintsPath);
    expectIncludes(constraints, 'fastapi==', `${service.name}: constraints.txt should pin FastAPI`);
    expectIncludes(constraints, 'ruff==', `${service.name}: constraints.txt should pin Ruff for consistent linting`);
  }

  if (dockerfilePath) {
    const dockerfile = read(dockerfilePath);
    expectIncludes(dockerfile, 'requirements.lock', `${service.name}: production Dockerfile must copy requirements.lock`);
    expectIncludes(
      dockerfile,
      '--require-hashes -r requirements.lock',
      `${service.name}: production Dockerfile must enforce locked dependency hashes`
    );
    expectIncludes(dockerfile, 'USER ', `${service.name}: production Dockerfile must switch to a non-root user`);
    expectNotIncludes(
      dockerfile,
      '-r requirements.txt',
      `${service.name}: production Dockerfile must not install mutable runtime requirements`
    );
  }

  if (ciPath) {
    const ci = read(ciPath);
    expectIncludes(ci, 'ruff check .', `${service.name}: CI must run Ruff`);
    expectIncludes(ci, 'pip-audit -r requirements.lock', `${service.name}: CI must audit the hash lock`);
    expectIncludes(ci, 'requirements.lock', `${service.name}: CI must reference the runtime lock`);
  }

  if (dockerignorePath) {
    const dockerignore = read(dockerignorePath);
    for (const needle of ['.venv', '.pytest_cache', '.ruff_cache', '.env', '*.db']) {
      expectIncludes(dockerignore, needle, `${service.name}: .dockerignore must exclude local/runtime artifacts`);
    }
  }
}

if (!checkedAnyService) {
  warn(`Skipping Python service standards; no sibling service repos found under ${workspaceRoot}`);
}

for (const warning of warnings) {
  console.warn(warning);
}

if (failures.length > 0) {
  console.error('Python service standards checks failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(
    '\nThese checks intentionally encode cross-service supply-chain and lint standards so future changes do not drift.'
  );
  process.exit(1);
}

console.log('Python service standards checks passed.');
