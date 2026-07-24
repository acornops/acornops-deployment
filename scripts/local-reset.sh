#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/local-k8s.sh"
DEFAULT_ENV_FILE="${ROOT_DIR}/env/local/.env.local"
DEFAULT_AGENT_ENV_FILE="${ROOT_DIR}/env/local/.env.agent"
ENV_FILE="${1:-}"
AGENT_ENV_FILE="${2:-}"
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

if [[ -z "${AGENT_ENV_FILE}" ]]; then
  AGENT_ENV_FILE="${DEFAULT_AGENT_ENV_FILE}"
fi

set -a
source "${ENV_FILE}"
if [[ -f "${AGENT_ENV_FILE}" ]]; then
  source "${AGENT_ENV_FILE}"
fi
set +a

if [[ -n "${CLI_EXTRA_PROFILES}" ]]; then
  LOCAL_EXTRA_PROFILES="${CLI_EXTRA_PROFILES}"
fi
LOCAL_EXTRA_PROFILES="${LOCAL_EXTRA_PROFILES:-}"

COMPOSE_PROFILE_ARGS=(--profile local --profile oidc-dex --profile oidc-keycloak --profile local-vault)
if [[ -n "${LOCAL_EXTRA_PROFILES}" ]]; then
  EXTRA_PROFILE_LIST="${LOCAL_EXTRA_PROFILES//,/ }"
  for profile in ${EXTRA_PROFILE_LIST}; do
    COMPOSE_PROFILE_ARGS+=(--profile "${profile}")
  done
fi

ao_heading "Resetting local AcornOps stack (containers, networks, and named volumes)..."
docker compose "${COMPOSE_FILES[@]}" "${COMPOSE_PROFILE_ARGS[@]}" --env-file "${ENV_FILE}" down --volumes --remove-orphans

local_k8s_prepare_stack_kubeconfig || true

kctl() {
  local_k8s_kubectl "$@"
}

: "${RESET_DEMO_K3S_WORKLOADS:=true}"
: "${DEMO_K8S_NAMESPACE:=acornops-demo}"
if [[ "${RESET_DEMO_K3S_WORKLOADS}" == "true" ]] && command -v kubectl >/dev/null 2>&1; then
  if kctl --request-timeout=5s get namespace "${DEMO_K8S_NAMESPACE}" >/dev/null 2>&1; then
    ao_step "Removing demo namespace ${DEMO_K8S_NAMESPACE} from local Kubernetes cluster..."
    kctl delete namespace "${DEMO_K8S_NAMESPACE}" --wait=false >/dev/null || true
  fi
fi

ao_ok "Local stack reset complete."
