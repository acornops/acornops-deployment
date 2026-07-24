#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
LOCAL_EXTRA_PROFILES="${LOCAL_EXTRA_PROFILES:-}"

COMPOSE_PROFILE_ARGS=(--profile local --profile "${LOCAL_OIDC_PROFILE}")
if [[ -n "${LOCAL_EXTRA_PROFILES}" ]]; then
  EXTRA_PROFILE_LIST="${LOCAL_EXTRA_PROFILES//,/ }"
  for profile in ${EXTRA_PROFILE_LIST}; do
    COMPOSE_PROFILE_ARGS+=(--profile "${profile}")
  done
fi

docker compose "${COMPOSE_FILES[@]}" "${COMPOSE_PROFILE_ARGS[@]}" --env-file "${ENV_FILE}" down
