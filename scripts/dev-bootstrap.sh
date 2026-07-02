#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_DIR="$(cd "${ROOT_DIR}/.." && pwd)"

setup_terminal_colors() {
  if [[ -t 1 && "${TERM:-}" != "dumb" ]]; then
    AO_RESET=$'\033[0m'
    AO_BOLD=$'\033[1m'
    AO_DIM=$'\033[2m'
    AO_RED=$'\033[31m'
    AO_GREEN=$'\033[32m'
    AO_YELLOW=$'\033[33m'
    AO_BLUE=$'\033[34m'
    AO_CYAN=$'\033[36m'
    AO_GRAY=$'\033[90m'
    return
  fi

  AO_RESET=""
  AO_BOLD=""
  AO_DIM=""
  AO_RED=""
  AO_GREEN=""
  AO_YELLOW=""
  AO_BLUE=""
  AO_CYAN=""
  AO_GRAY=""
}

required_workspace_repos() {
  printf '%s\n' \
    "management-console" \
    "control-plane" \
    "execution-engine" \
    "llm-gateway" \
    "agentk"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ao_print() {
  printf '%b%s%b\n' "$1" "$2" "${AO_RESET}"
}

ao_heading() {
  ao_print "${AO_BOLD}${AO_CYAN}" "$1"
}

ao_step() {
  ao_print "${AO_BLUE}" "$1"
}

ao_ok() {
  ao_print "${AO_GREEN}" "$1"
}

ao_warn() {
  ao_print "${AO_YELLOW}" "$1"
}

ao_error() {
  ao_print "${AO_RED}" "$1"
}

ao_note() {
  ao_print "${AO_DIM}${AO_GRAY}" "$1"
}

repo_exists() {
  local repo_name="$1"
  [[ -d "${WORKSPACE_DIR}/${repo_name}" ]]
}

ensure_env_file() {
  local target_path="$1"
  local example_path="$2"

  if [[ -f "${target_path}" ]]; then
    return 0
  fi

  cp "${example_path}" "${target_path}"
  ao_ok "Created $(basename "${target_path}") from $(basename "${example_path}")."
}

setup_terminal_colors
