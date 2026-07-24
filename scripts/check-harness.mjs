import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function expectIncludes(content, needle, message) {
  expect(content.includes(needle), `${message}: missing ${needle}`);
}

const requiredFiles = [
  'AGENTS.md',
  'ARCHITECTURE.md',
  'docs/index.md',
  'docs/DEVELOPMENT.md',
  'docs/OPERATIONS.md',
  'docs/deployment-architecture.md',
  'docs/system-architecture.md',
  'docs/DESIGN.md',
  'docs/PLANS.md',
  'docs/AGENT_HANDOFF.md',
  'docs/QUALITY_SCORE.md',
  'docs/RELIABILITY.md',
  'docs/SECURITY.md',
  'docs/security-model.md',
  'docs/design-docs/index.md',
  'docs/design-docs/core-beliefs.md',
  'docs/product-specs/index.md',
  'docs/product-specs/component-charter.md',
  'docs/references/index.md',
  'docs/generated/README.md',
  'docs/exec-plans/active/README.md',
  'docs/exec-plans/completed/README.md',
  'docs/exec-plans/tech-debt-tracker.md',
  'docs/contracts/README.md',
  'docs/contracts/manifest.json',
  'scripts/local-smoke.mjs',
  '.agents/skills/README.md',
  '.agents/skills/shared/.standards-version'
];

for (const file of requiredFiles) {
  expect(existsSync(path.join(root, file)), `Missing required harness file ${file}`);
}

const agents = read('AGENTS.md');
const docsIndex = read('docs/index.md');
const development = read('docs/DEVELOPMENT.md');
const plans = read('docs/PLANS.md');
const handoff = read('docs/AGENT_HANDOFF.md');
const quality = read('docs/QUALITY_SCORE.md');
const reliability = read('docs/RELIABILITY.md');
const security = read('docs/SECURITY.md');
const securityModel = read('docs/security-model.md');
const designIndex = read('docs/design-docs/index.md');
const productIndex = read('docs/product-specs/index.md');
const readme = read('README.md');
const k8sHaSmoke = read('scripts/k8s-ha-smoke.mjs');
const taskfile = read('Taskfile.yml');

expect(agents.split('\n').length <= 140, 'AGENTS.md should stay short enough to serve as a table of contents');
expect(!agents.includes('/Users/'), 'AGENTS.md should use portable relative links, not workstation-specific absolute paths');
expectIncludes(agents, '.agents/skills/shared', 'AGENTS shared skills guidance');
expectIncludes(agents, '.agents/skills/local', 'AGENTS local skills guidance');
expectIncludes(agents, 'docs/AGENT_HANDOFF.md', 'AGENTS handoff guidance');
expectIncludes(agents, 'Docs impact: none', 'AGENTS docs impact guidance');

for (const needle of [
  'ARCHITECTURE.md',
  'docs/index.md',
  'docs/DEVELOPMENT.md',
  'docs/OPERATIONS.md',
  'docs/deployment-architecture.md',
  'docs/system-architecture.md',
  'docs/contracts/README.md',
  'docs/PLANS.md',
  'docs/AGENT_HANDOFF.md',
  'docs/QUALITY_SCORE.md',
  'docs/RELIABILITY.md',
  'docs/SECURITY.md',
  'docs/security-model.md'
]) {
  expectIncludes(agents, needle, 'AGENTS entry point link');
}

for (const needle of [
  'ARCHITECTURE.md',
  'DEVELOPMENT.md',
  'OPERATIONS.md',
  'deployment-architecture.md',
  'system-architecture.md',
  'docs/contracts/README.md',
  'docs/design-docs/index.md',
  'docs/product-specs/index.md',
  'docs/PLANS.md',
  'docs/AGENT_HANDOFF.md',
  'docs/QUALITY_SCORE.md',
  'docs/RELIABILITY.md',
  'docs/SECURITY.md',
  'docs/security-model.md'
]) {
  expectIncludes(docsIndex, needle, 'Docs index link');
}

for (const needle of [
  'docs/exec-plans/active/README.md',
  'docs/exec-plans/completed/README.md',
  'docs/exec-plans/tech-debt-tracker.md'
]) {
  expectIncludes(plans, needle, 'Plans index link');
}

expectIncludes(quality, '| Area | Score | Evidence | Main Gap |', 'Quality score table');
expectIncludes(handoff, 'exact commands run', 'Agent handoff evidence');
expectIncludes(handoff, 'Docs impact: none', 'Agent handoff docs impact evidence');
expectIncludes(handoff, 'Conventional Commits', 'Agent handoff commit policy');
expectIncludes(handoff, 'not a GitHub CI gate', 'Agent handoff commit policy enforcement boundary');
expectIncludes(handoff, 'Vendor Neutrality', 'Agent handoff vendor-neutral policy');
expectIncludes(development, '## Documentation Drift Control', 'Development guide docs drift section');
expectIncludes(development, 'Docs impact: none', 'Development guide docs impact guidance');
expectIncludes(reliability, '## Failure Modes', 'Reliability heading');
expectIncludes(reliability, '## Required Validation', 'Reliability validation heading');
expectIncludes(securityModel, '## Trust Boundaries', 'Security trust-boundary heading');
expectIncludes(securityModel, '## Secrets', 'Security secrets heading');
expectIncludes(securityModel, '## High-Risk Changes', 'Security high-risk heading');
expectIncludes(security, '## Reporting a Vulnerability', 'Security policy reporting heading');
expectIncludes(security, 'https://discord.gg/KHUUdXfsXv', 'Security policy Discord reporting channel');
expectIncludes(designIndex, 'Verified', 'Design index verification status');
expectIncludes(designIndex, 'core-beliefs.md', 'Design index core beliefs link');
expectIncludes(productIndex, 'component-charter.md', 'Product spec index component charter link');
expectIncludes(readme, 'AGENTS.md', 'README harness link');
expectIncludes(readme, 'docs/index.md', 'README docs index link');
expectIncludes(readme, 'docs/DEVELOPMENT.md', 'README development guide link');
expectIncludes(readme, 'docs/OPERATIONS.md', 'README operations guide link');
expectIncludes(readme, 'docs/deployment-architecture.md', 'README deployment architecture link');
expectIncludes(readme, '../docs/system-architecture.md', 'README workspace system architecture link');
expect(k8sHaSmoke.split('\n').length <= 250, 'scripts/k8s-ha-smoke.mjs should stay below 250 lines; move reusable logic under scripts/lib/k8s-ha-smoke/');
expectIncludes(k8sHaSmoke, './lib/k8s-ha-smoke/', 'k8s HA smoke should use helper modules for reusable logic');
expectIncludes(taskfile, 'validate:', 'Taskfile canonical validate task');
expectIncludes(taskfile, 'contracts:check:', 'Taskfile canonical contract check task');
expectIncludes(taskfile, 'harness:check:', 'Taskfile canonical harness check task');
expectIncludes(taskfile, 'platform-contracts:', 'Taskfile platform contract check task');
expectIncludes(taskfile, 'local-smoke:', 'Taskfile local full-stack smoke task');
expectIncludes(taskfile, 'local-agentv-smoke:', 'Taskfile focused AgentV smoke task');
expectIncludes(readme, 'task local-smoke', 'README local full-stack smoke command');

for (const metadataPath of [
  '.DS_Store',
  '.agents/.DS_Store',
  '.agents/skills/.DS_Store',
  '.agents/skills/shared/.DS_Store'
]) {
  expect(!existsSync(path.join(root, metadataPath)), `Remove generated macOS metadata file ${metadataPath}`);
}

for (const vendorPath of ['CLAUDE.md', 'GEMINI.md', '.cursor', '.cursorrules']) {
  expect(!existsSync(path.join(root, vendorPath)), `Do not add required vendor-specific agent instruction file ${vendorPath}`);
}

if (failures.length > 0) {
  console.error('Deployment harness checks failed:\n');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Deployment harness checks passed.');
