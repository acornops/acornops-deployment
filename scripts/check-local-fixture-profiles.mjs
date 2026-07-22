import { spawnSync } from 'node:child_process';

const composeFiles = [
  '-f', 'compose/vm-prod/compose.yaml',
  '-f', 'compose/local/compose.source.yaml'
];

function render(extraProfiles, environment) {
  const profileArgs = ['--profile', 'local', '--profile', 'oidc-dex'];
  for (const profile of extraProfiles) profileArgs.push('--profile', profile);
  const result = spawnSync(
    'docker',
    ['compose', ...composeFiles, ...profileArgs, '--env-file', 'env/local/.env.example', 'config', '--format', 'json'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        SEED_DEVELOPMENT_DATA: 'true',
        SEED_AGENT_KEY: 'ak_local_dev_shared_key',
        SEED_VM_AGENT_KEY: 'ak_local_vm_dev_shared_key',
        LOCAL_CLUSTER_ID: '',
        LOCAL_AGENT_KEY: '',
        LOCAL_VM_TARGET_ID: '9254df42-4d9b-4e63-8bb6-93442e7d9a45',
        LOCAL_VM_AGENT_KEY: 'ak_local_vm_dev_shared_key',
        ...environment
      }
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'docker compose config failed');
  }
  return JSON.parse(result.stdout);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const defaultConfig = render([], {});
expect(defaultConfig.services['control-plane'].environment.SEED_DEVELOPMENT_DATA === 'true', 'default local profile must seed development targets');
expect(defaultConfig.services['control-plane'].environment.SEED_AGENT_KEY === 'ak_local_dev_shared_key', 'default local profile must pass the AgentK seed key');
expect(defaultConfig.services['control-plane'].environment.SEED_VM_AGENT_KEY === 'ak_local_vm_dev_shared_key', 'default local profile must pass the AgentV seed key');
expect(
  JSON.parse(defaultConfig.services['control-plane'].environment.OIDC_PRELINKED_IDENTITIES_JSON)[0]?.subject === 'Cgt1LWRldi1sb2NhbBIFbG9jYWw',
  'default local profile must prelink the seeded owner to the fixed Dex OIDC subject'
);
expect(defaultConfig.services['management-console'].environment.VITE_APP_DATA_MODE === 'control-plane', 'full-stack management console must use control-plane data mode');
expect(!defaultConfig.services.agentk, 'default local profile must not include AgentK');
expect(!defaultConfig.services.agentv, 'default local profile must not include AgentV');

const clusterFixtureConfig = render(['cluster-fixture'], {
  SEED_DEVELOPMENT_DATA: 'true',
  SEED_AGENT_KEY: 'ak_local_dev_shared_key',
  SEED_VM_AGENT_KEY: 'ak_local_vm_dev_shared_key',
  LOCAL_CLUSTER_ID: '5b006e4c-509c-458a-9f02-5aafbdc01ade',
  LOCAL_AGENT_KEY: 'ak_local_dev_shared_key'
});
expect(clusterFixtureConfig.services['control-plane'].environment.SEED_DEVELOPMENT_DATA === 'true', 'cluster-fixture profile must enable development seeding');
expect(clusterFixtureConfig.services['control-plane'].environment.SEED_AGENT_KEY === 'ak_local_dev_shared_key', 'cluster-fixture profile must pass the reserved AgentK registration key');
expect(clusterFixtureConfig.services['control-plane'].environment.SEED_VM_AGENT_KEY === 'ak_local_vm_dev_shared_key', 'cluster-fixture profile must retain the seeded VM registration key');
expect(Boolean(clusterFixtureConfig.services.agentk), 'cluster-fixture profile must include AgentK');
expect(!clusterFixtureConfig.services.agentv, 'cluster-fixture profile must exclude AgentV');

const targetFixtureConfig = render(['target-fixtures'], {
  LOCAL_CLUSTER_ID: '5b006e4c-509c-458a-9f02-5aafbdc01ade',
  LOCAL_AGENT_KEY: 'ak_local_dev_shared_key',
  LOCAL_VM_TARGET_ID: '9254df42-4d9b-4e63-8bb6-93442e7d9a45',
  LOCAL_VM_AGENT_KEY: 'ak_local_vm_dev_shared_key'
});
expect(targetFixtureConfig.services['control-plane'].environment.SEED_DEVELOPMENT_DATA === 'true', 'target-fixtures profile must seed control-plane target records');
expect(targetFixtureConfig.services['control-plane'].environment.SEED_AGENT_KEY === 'ak_local_dev_shared_key', 'target-fixtures profile must pass the AgentK seed key');
expect(targetFixtureConfig.services['control-plane'].environment.SEED_VM_AGENT_KEY === 'ak_local_vm_dev_shared_key', 'target-fixtures profile must pass the AgentV seed key');
expect(Boolean(targetFixtureConfig.services.agentk), 'target-fixtures profile must include AgentK');
expect(Boolean(targetFixtureConfig.services.agentv), 'target-fixtures profile must include AgentV');
expect(targetFixtureConfig.services.agentk.environment.ACORNOPS_CLUSTER_ID === '5b006e4c-509c-458a-9f02-5aafbdc01ade', 'target-fixtures AgentK must use the seeded cluster ID');
expect(targetFixtureConfig.services.agentv.environment.ACORNOPS_TARGET_ID === '9254df42-4d9b-4e63-8bb6-93442e7d9a45', 'target-fixtures AgentV must use the seeded VM ID');

console.log('local fixture compose profile checks passed');
