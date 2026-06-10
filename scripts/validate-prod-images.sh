#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/compose/vm-prod/compose.yaml"

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Missing production compose file: ${COMPOSE_FILE}" >&2
  exit 1
fi

semver_tag='[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?'

for component in MANAGEMENT_CONSOLE_IMAGE CONTROL_PLANE_IMAGE EXECUTION_ENGINE_IMAGE LLM_GATEWAY_IMAGE; do
  if grep -Eq "\\$\\{${component}:-[^}]+:latest\\}" "${COMPOSE_FILE}"; then
    echo "Production compose default for ${component} must not use :latest" >&2
    exit 1
  fi
  if ! grep -Eq "\\$\\{${component}:-ghcr\\.io/acornops/[^}]+:${semver_tag}\\}" "${COMPOSE_FILE}"; then
    echo "Production compose default for ${component} must use a pinned ghcr.io/acornops image" >&2
    exit 1
  fi
done

if grep -Eq 'image: \$\{(MANAGEMENT_CONSOLE_IMAGE|CONTROL_PLANE_IMAGE|EXECUTION_ENGINE_IMAGE|LLM_GATEWAY_IMAGE):-[^}]+:(latest|main|master|dev)\}' "${COMPOSE_FILE}"; then
  echo "Production compose contains a mutable application image fallback" >&2
  exit 1
fi

echo "Production image validation passed."
