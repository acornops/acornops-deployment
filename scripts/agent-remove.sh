#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/env/vm/.env.agent"
ENV_FILE="${1:-}"

if [[ -z "${ENV_FILE}" ]]; then
  if [[ -f "${DEFAULT_ENV_FILE}" ]]; then
    ENV_FILE="${DEFAULT_ENV_FILE}"
  else
    ENV_FILE="${DEFAULT_ENV_FILE}"
  fi
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}"
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

: "${K8S_NAMESPACE:=acornops}"
: "${ACORNOPS_AGENT_LEASE_NAMESPACE:=${K8S_NAMESPACE}}"

kubectl -n "${K8S_NAMESPACE}" delete deployment acornops-agentk --ignore-not-found
kubectl -n "${K8S_NAMESPACE}" delete secret acornops-agentk-secret --ignore-not-found
kubectl -n "${ACORNOPS_AGENT_LEASE_NAMESPACE}" delete rolebinding acornops-agentk-leader-election --ignore-not-found
kubectl -n "${ACORNOPS_AGENT_LEASE_NAMESPACE}" delete role acornops-agentk-leader-election --ignore-not-found
kubectl delete clusterrolebinding acornops-agentk-binding --ignore-not-found
kubectl delete clusterrole acornops-agentk-role --ignore-not-found
kubectl -n "${K8S_NAMESPACE}" delete serviceaccount acornops-agentk --ignore-not-found

echo "agentk resources removed from namespace ${K8S_NAMESPACE}."
