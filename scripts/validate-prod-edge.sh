#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="${ROOT_DIR}/compose/vm-prod/proxy/nginx.conf.template"
LOCAL_TEMPLATE="${ROOT_DIR}/compose/vm-prod/proxy/nginx.local.conf.template"

for template_path in "${TEMPLATE}" "${LOCAL_TEMPLATE}"; do
  if [[ ! -f "${template_path}" ]]; then
    echo "Missing nginx template: ${template_path}" >&2
    exit 1
  fi
done

validate_redacted_access_logs() {
  local template_path="$1"
  local template_label="$2"
  local server_count
  local safe_access_log_count

  if grep -Fq '$request ' "${template_path}"; then
    echo "${template_label} edge access logs must omit query strings and one-time authentication handles" >&2
    exit 1
  fi
  if grep -Fq '$http_referer' "${template_path}"; then
    echo "${template_label} edge access logs must omit referrers that could contain provider logout URLs" >&2
    exit 1
  fi

  server_count="$(grep -Ec '^[[:space:]]*server \{' "${template_path}")"
  safe_access_log_count="$(grep -Fc 'access_log /var/log/nginx/access.log acornops;' "${template_path}")"
  if [[ "${safe_access_log_count}" -ne "${server_count}" ]]; then
    echo "Every ${template_label} edge server must override inherited access logs with the redacted format" >&2
    exit 1
  fi
}

for forbidden in \
  '${CONTROL_PLANE_HOST}' \
  '${LLM_GATEWAY_HOST}' \
  '${EXECUTION_ENGINE_HOST}' \
  'proxy_pass http://llm-gateway:8001' \
  'proxy_pass http://execution-engine:8080'
do
  if grep -Fq "${forbidden}" "${TEMPLATE}"; then
    echo "Production edge exposes an internal-only service: ${forbidden}" >&2
    exit 1
  fi
done

for required in \
  'server_name ${MANAGEMENT_CONSOLE_HOST}' \
  'server_name ${API_HOST}' \
  'location /api/' \
  'proxy_pass http://control-plane:8081' \
  'Content-Security-Policy' \
  'Strict-Transport-Security' \
  'X-Content-Type-Options' \
  'Referrer-Policy' \
  'Permissions-Policy' \
  'log_format acornops' \
  '$request_method $uri $server_protocol'
do
  if ! grep -Fq "${required}" "${TEMPLATE}"; then
    echo "Production edge is missing required public control-plane routing: ${required}" >&2
    exit 1
  fi
done

validate_redacted_access_logs "${TEMPLATE}" "Production"
validate_redacted_access_logs "${LOCAL_TEMPLATE}" "Local"

if grep -Fq '${MANAGEMENT_CONSOLE_PATH_PREFIX}' "${TEMPLATE}"; then
  echo "Production edge must serve the management console at the host root, not a path prefix" >&2
  exit 1
fi

old_api_host_var='$'
old_api_host_var="${old_api_host_var}{ACORNOPS""_HOST}"
if grep -Fq "${old_api_host_var}" "${TEMPLATE}" || grep -Fq "${old_api_host_var}" "${ROOT_DIR}/compose/vm-prod/compose.yaml"; then
  echo "Production edge should use API_HOST for the public control-plane host" >&2
  exit 1
fi

if grep -Fq 'Documentation site is not deployed yet' "${TEMPLATE}"; then
  echo "Production edge must not serve placeholder documentation content" >&2
  exit 1
fi

if ! grep -Fq 'MANAGEMENT_CONSOLE_UPSTREAM:-management-console:8080' "${ROOT_DIR}/compose/vm-prod/compose.yaml"; then
  echo "Production edge should target the non-root management console port 8080" >&2
  exit 1
fi

echo "Production edge exposure validation passed."
