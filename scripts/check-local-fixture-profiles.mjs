import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

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
expect(
  defaultConfig.services['llm-gateway'].environment.LLM_PROVIDER_OPENAI_API_SURFACE === 'responses',
  'default local profile must use the OpenAI Responses API'
);
expect(!defaultConfig.services.agentk, 'default local profile must not include AgentK');
expect(!defaultConfig.services.agentv, 'default local profile must not include AgentV');
expect(!defaultConfig.services['platform-admin-console'], 'base Compose profile must not include the platform-admin console without its profile');
expect(defaultConfig.services['control-plane'].environment.CONTROL_PLANE_ADMIN_API_ENABLED === 'false', 'base Compose profile must keep the admin API disabled without the platform-admin profile');

const chatCompletionsConfig = render([], {
  LLM_PROVIDER_OPENAI_API_SURFACE: 'chat_completions'
});
expect(
  chatCompletionsConfig.services['llm-gateway'].environment.LLM_PROVIDER_OPENAI_API_SURFACE ===
    'chat_completions',
  'local profile must pass the explicit OpenAI Chat Completions API surface'
);

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

const localAdminToken = 'acornops-local-platform-admin-bff-token';
const localAdminTokenHash = createHash('sha256').update(localAdminToken).digest('hex');
const platformAdminConfig = render(['platform-admin'], {
  CONTROL_PLANE_ADMIN_API_ENABLED: 'true',
  CONTROL_PLANE_ADMIN_HUMAN_AUTH_REQUIRED: 'true',
  PLATFORM_ADMIN_BFF_TOKEN: localAdminToken,
  CONTROL_PLANE_ADMIN_TOKENS_JSON: JSON.stringify([
    {
      id: 'platform-admin-console',
      name: 'Local platform admin console',
      sha256: localAdminTokenHash,
      scopes: [
        'admin:self',
        'admin:system:read',
        'admin:system:write',
        'admin:workspace:read',
        'admin:workspace:write',
        'admin:user:read',
        'admin:member:write',
        'admin:audit:read'
      ],
      enabled: true
    }
  ])
});
const platformAdminService = platformAdminConfig.services['platform-admin-console'];
const platformAdminDescriptors = JSON.parse(platformAdminConfig.services['control-plane'].environment.CONTROL_PLANE_ADMIN_TOKENS_JSON);
expect(Boolean(platformAdminService), 'platform-admin profile must include the platform-admin console');
expect(Boolean(platformAdminConfig.services.keycloak), 'platform-admin profile must include its dedicated Keycloak identity provider');
expect(Boolean(platformAdminConfig.services['keycloak-postgres']), 'platform-admin profile must include the Keycloak database');
expect(platformAdminService.environment.ADMIN_CONSOLE_DATA_MODE === 'control-plane', 'platform-admin console must use control-plane data mode');
expect(platformAdminService.environment.CONTROL_PLANE_ADMIN_BASE_URL === 'http://control-plane:8081', 'platform-admin console must use the internal control-plane URL');
expect(platformAdminService.environment.CONTROL_PLANE_ADMIN_TOKEN === localAdminToken, 'platform-admin console must receive the local BFF token');
expect(platformAdminService.environment.NODE_ENV === 'production', 'platform-admin console must preserve production human-session enforcement');
expect(platformAdminService.build.target === 'dev', 'platform-admin console must use its development image target locally');
expect(platformAdminService.command.join(' ') === 'npm run dev', 'platform-admin console must start its hot-reload development command');
expect(platformAdminService.volumes.some((volume) => volume.target === '/app'), 'platform-admin console must mount local source');
expect(platformAdminService.volumes.some((volume) => volume.target === '/app/node_modules'), 'platform-admin console must isolate container dependencies');
expect(platformAdminService.ports[0].host_ip === '127.0.0.1', 'platform-admin console must bind only to the loopback interface');
expect(platformAdminConfig.services['control-plane'].environment.CONTROL_PLANE_ADMIN_API_ENABLED === 'true', 'platform-admin profile must enable the admin API');
expect(platformAdminConfig.services['control-plane'].environment.CONTROL_PLANE_ADMIN_HUMAN_AUTH_REQUIRED === 'true', 'platform-admin profile must require a human admin session');
expect(platformAdminDescriptors.length === 1 && platformAdminDescriptors[0].sha256 === localAdminTokenHash, 'platform-admin BFF token must match its SHA-256 descriptor');
expect(
  platformAdminDescriptors[0].scopes.join(',') === 'admin:self,admin:system:read,admin:system:write,admin:workspace:read,admin:workspace:write,admin:user:read,admin:member:write,admin:audit:read',
  'platform-admin BFF descriptor must contain only the eight console scopes'
);

console.log('local fixture compose profile checks passed');
