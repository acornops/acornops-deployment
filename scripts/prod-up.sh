#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/env/vm/.env.prod"
ENV_FILE="${1:-}"
COMPOSE_FILE="${ROOT_DIR}/compose/vm-prod/compose.yaml"
ADDITIONAL_CA_COMPOSE_FILE="${ROOT_DIR}/compose/vm-prod/compose.additional-ca.yaml"

if [[ -z "${ENV_FILE}" ]]; then
  if [[ -f "${DEFAULT_ENV_FILE}" ]]; then
    ENV_FILE="${DEFAULT_ENV_FILE}"
  else
    ENV_FILE="${DEFAULT_ENV_FILE}"
  fi
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}"
  echo "Copy ${ROOT_DIR}/env/vm/.env.example to ${ROOT_DIR}/env/vm/.env.prod and edit values."
  exit 1
fi

COMPOSE_FILES=(-f "${COMPOSE_FILE}")
if grep -Eq '^[[:space:]]*ADDITIONAL_CA_BUNDLE_SOURCE_PATH=[^[:space:]].*$' "${ENV_FILE}"; then
  COMPOSE_FILES+=(-f "${ADDITIONAL_CA_COMPOSE_FILE}")
fi
COMPOSE_CMD=(docker compose "${COMPOSE_FILES[@]}" --profile prod --env-file "${ENV_FILE}")

"${COMPOSE_CMD[@]}" pull

echo "Running llm-gateway migrations..."
"${COMPOSE_CMD[@]}" run --rm llm-gateway-init

echo "Running control-plane migrations..."
"${COMPOSE_CMD[@]}" run --rm control-plane-init

"${COMPOSE_CMD[@]}" up -d
