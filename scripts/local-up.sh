#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/local-k8s.sh"
DEFAULT_ENV_FILE="${ROOT_DIR}/env/local/.env.local"
DEFAULT_AGENT_ENV_FILE="${ROOT_DIR}/env/local/.env.agent"
ENV_FILE="${1:-}"
AGENT_ENV_FILE="${2:-}"
CLI_OIDC_PROFILE="${LOCAL_OIDC_PROFILE:-}"
CLI_EXTRA_PROFILES="${LOCAL_EXTRA_PROFILES:-}"
COMPOSE_FILES=(-f "${ROOT_DIR}/compose/vm-prod/compose.yaml" -f "${ROOT_DIR}/compose/local/compose.source.yaml")

if [[ -z "${ENV_FILE}" ]]; then
  if [[ -f "${DEFAULT_ENV_FILE}" ]]; then
    ENV_FILE="${DEFAULT_ENV_FILE}"
  else
    ENV_FILE="${DEFAULT_ENV_FILE}"
  fi
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}"
  echo "Copy ${ROOT_DIR}/env/local/.env.example to ${ROOT_DIR}/env/local/.env.local and edit values."
  exit 1
fi

ensure_local_gateway_signing_key() {
  if grep -Eq '^GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64=.+$' "${ENV_FILE}"; then
    return
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "Missing required command: openssl (needed to create the persistent local gateway signing key)."
    exit 1
  fi

  local generated_key temp_env
  generated_key="$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null | base64 | tr -d '\r\n')"
  if [[ -z "${generated_key}" ]]; then
    echo "Failed to generate the persistent local gateway signing key."
    exit 1
  fi
  temp_env="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v value="${generated_key}" '
    BEGIN { replaced = 0 }
    /^GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64=/ {
      if (!replaced) print "GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64=" value
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print "GATEWAY_SIGNING_PRIVATE_KEY_PEM_B64=" value
    }
  ' "${ENV_FILE}" > "${temp_env}"
  chmod 600 "${temp_env}"
  mv "${temp_env}" "${ENV_FILE}"
  unset generated_key
  echo "Generated a persistent local gateway signing key in ${ENV_FILE}."
}

ensure_local_gateway_signing_key

if [[ -z "${AGENT_ENV_FILE}" ]]; then
  AGENT_ENV_FILE="${DEFAULT_AGENT_ENV_FILE}"
fi

set -a
source "${ENV_FILE}"
if [[ -f "${AGENT_ENV_FILE}" ]]; then
  source "${AGENT_ENV_FILE}"
fi
set +a

if [[ -n "${CLI_OIDC_PROFILE}" ]]; then
  LOCAL_OIDC_PROFILE="${CLI_OIDC_PROFILE}"
fi
: "${LOCAL_OIDC_PROFILE:=oidc-dex}"
if [[ -n "${CLI_EXTRA_PROFILES}" ]]; then
  LOCAL_EXTRA_PROFILES="${CLI_EXTRA_PROFILES}"
fi
LOCAL_EXTRA_PROFILES="${LOCAL_EXTRA_PROFILES:-target-fixtures}"

profile_enabled() {
  local requested="$1"
  local configured="${LOCAL_EXTRA_PROFILES//,/ }"
  for profile in ${configured}; do
    if [[ "${profile}" == "${requested}" ]]; then
      return 0
    fi
  done
  return 1
}

if profile_enabled target-fixtures && profile_enabled cluster-fixture; then
  echo "Choose either target-fixtures or cluster-fixture, not both."
  exit 1
fi

export SEED_DEVELOPMENT_DATA=true
: "${LOCAL_CLUSTER_ID:=5b006e4c-509c-458a-9f02-5aafbdc01ade}"
: "${LOCAL_AGENT_KEY:=ak_local_dev_shared_key}"
: "${LOCAL_VM_TARGET_ID:=9254df42-4d9b-4e63-8bb6-93442e7d9a45}"
: "${LOCAL_VM_AGENT_KEY:=ak_local_vm_dev_shared_key}"
export LOCAL_CLUSTER_ID LOCAL_AGENT_KEY LOCAL_VM_TARGET_ID LOCAL_VM_AGENT_KEY
export SEED_AGENT_KEY="${LOCAL_AGENT_KEY}"
export SEED_VM_AGENT_KEY="${LOCAL_VM_AGENT_KEY}"

if profile_enabled cluster-fixture; then
  local_k3d_ensure_cluster
  local_k8s_prepare_stack_kubeconfig || true
elif profile_enabled target-fixtures; then
  local_k3d_ensure_cluster
  local_k8s_prepare_stack_kubeconfig || true
fi

export OIDC_END_SESSION_ENDPOINT_OVERRIDE=""
export OIDC_PRELINKED_IDENTITIES_JSON='[{"subject":"Cgt1LWRldi1sb2NhbBIFbG9jYWw","email":"dev@acornops.local","displayName":"Dev User","emailVerified":true}]'
if [[ "${LOCAL_OIDC_PROFILE}" == "oidc-keycloak" ]]; then
  export OIDC_PROVIDER_NAME="keycloak"
  export OIDC_ISSUER_URL="http://keycloak:8080/realms/acornops"
  export OIDC_PUBLIC_ISSUER_URL="http://localhost:${KEYCLOAK_PORT:-8082}/realms/acornops"
  export OIDC_TOKEN_ENDPOINT_AUTH_METHOD="client_secret_basic"
  export OIDC_AUTHORIZATION_ENDPOINT_OVERRIDE="http://localhost:${KEYCLOAK_PORT:-8082}/realms/acornops/protocol/openid-connect/auth"
  export OIDC_TOKEN_ENDPOINT_OVERRIDE=""
  export OIDC_USERINFO_ENDPOINT_OVERRIDE=""
  export OIDC_JWKS_URI_OVERRIDE=""
  export OIDC_END_SESSION_ENDPOINT_OVERRIDE="http://localhost:${KEYCLOAK_PORT:-8082}/realms/acornops/protocol/openid-connect/logout"
  export OIDC_PRELINKED_IDENTITIES_JSON='[{"subject":"10000000-0000-4000-8000-000000000001","email":"dev@acornops.local","displayName":"Dev User","emailVerified":true}]'
fi

COMPOSE_PROFILE_ARGS=(--profile local --profile "${LOCAL_OIDC_PROFILE}")
if [[ -n "${LOCAL_EXTRA_PROFILES}" ]]; then
  EXTRA_PROFILE_LIST="${LOCAL_EXTRA_PROFILES//,/ }"
  for profile in ${EXTRA_PROFILE_LIST}; do
    COMPOSE_PROFILE_ARGS+=(--profile "${profile}")
  done
fi

COMPOSE_CMD=(docker compose "${COMPOSE_FILES[@]}" "${COMPOSE_PROFILE_ARGS[@]}" --env-file "${ENV_FILE}")

ao_heading "Running llm-gateway migrations..."
"${COMPOSE_CMD[@]}" run --rm --build llm-gateway-init

ao_heading "Running control-plane migrations..."
"${COMPOSE_CMD[@]}" run --rm --build control-plane-init

ao_heading "Starting local stack..."
"${COMPOSE_CMD[@]}" up -d --build
"${COMPOSE_CMD[@]}" up -d --force-recreate --no-deps edge-proxy
if profile_enabled target-fixtures; then
  "${COMPOSE_CMD[@]}" up -d --force-recreate --no-deps agentk agentv
elif profile_enabled cluster-fixture; then
  "${COMPOSE_CMD[@]}" up -d --force-recreate --no-deps agentk
fi

kctl() {
  local_k8s_kubectl "$@"
}

seed_demo_workloads() {
  : "${SEED_DEMO_K3S_WORKLOADS:=true}"
  : "${DEMO_K8S_NAMESPACE:=acornops-demo}"

  if [[ "${SEED_DEMO_K3S_WORKLOADS}" != "true" ]]; then
    ao_note "Skipping demo workload seed: disabled by SEED_DEMO_K3S_WORKLOADS."
    return
  fi

  if ! command -v kubectl >/dev/null 2>&1; then
    ao_note "Skipping demo workload seed: kubectl not found."
    return
  fi

  if ! kctl --request-timeout=5s get namespace kube-system >/dev/null 2>&1; then
    ao_warn "Skipping demo workload seed: no reachable Kubernetes cluster in local stack kubeconfig."
    return
  fi

  local template_path="${ROOT_DIR}/k8s/demo-workloads.yaml.tpl"
  if [[ ! -f "${template_path}" ]]; then
    ao_warn "Skipping demo workload seed: template missing at ${template_path}."
    return
  fi

  ao_step "Applying demo workloads..."
  sed "s/__DEMO_NAMESPACE__/${DEMO_K8S_NAMESPACE}/g" "${template_path}" | kctl apply -f -
  kctl rollout status deployment/acornops-demo-healthy -n "${DEMO_K8S_NAMESPACE}" --timeout=120s >/dev/null || true
  ao_ok "Demo workloads applied in namespace ${DEMO_K8S_NAMESPACE}."
}

if profile_enabled target-fixtures || profile_enabled cluster-fixture; then
  seed_demo_workloads
fi
