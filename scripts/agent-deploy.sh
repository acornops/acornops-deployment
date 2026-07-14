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
  echo "Copy ${ROOT_DIR}/env/vm/.env.agent.example to ${ROOT_DIR}/env/vm/.env.agent and edit values."
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

: "${K8S_NAMESPACE:=acornops}"
: "${K8S_AGENT_REPLICAS:=1}"
: "${ACORNOPS_AGENT_IMAGE:=ghcr.io/acornops/agentk:0.0.1-experimental.8}"
: "${ACORNOPS_AGENT_PLATFORM_URL:?ACORNOPS_AGENT_PLATFORM_URL is required}"
: "${ACORNOPS_CLUSTER_ID:?ACORNOPS_CLUSTER_ID is required}"
: "${ACORNOPS_AGENT_KEY:?ACORNOPS_AGENT_KEY is required}"
: "${ACORNOPS_AGENT_WRITE_ENABLED:=false}"
: "${ACORNOPS_AGENT_LOG_LEVEL:=info}"
: "${ACORNOPS_AGENT_LEADER_ELECTION_ENABLED:=false}"
: "${ACORNOPS_AGENT_LEASE_NAME:=acornops-agent-leader}"
: "${ACORNOPS_AGENT_LEASE_NAMESPACE:=${K8S_NAMESPACE}}"
: "${ACORNOPS_AGENT_LEASE_DURATION_MS:=15000}"
: "${ACORNOPS_AGENT_RENEW_DEADLINE_MS:=10000}"
: "${ACORNOPS_AGENT_RETRY_PERIOD_MS:=2000}"

if [[ "${K8S_AGENT_REPLICAS}" -gt 1 && "${ACORNOPS_AGENT_LEADER_ELECTION_ENABLED}" != "true" ]]; then
  echo "K8S_AGENT_REPLICAS > 1 requires ACORNOPS_AGENT_LEADER_ELECTION_ENABLED=true; the agent supports active-passive HA only."
  exit 1
fi

if [[ "${ACORNOPS_AGENT_RENEW_DEADLINE_MS}" -ge "${ACORNOPS_AGENT_LEASE_DURATION_MS}" ]]; then
  echo "ACORNOPS_AGENT_RENEW_DEADLINE_MS must be less than ACORNOPS_AGENT_LEASE_DURATION_MS."
  exit 1
fi

if [[ "${ACORNOPS_AGENT_RETRY_PERIOD_MS}" -gt "${ACORNOPS_AGENT_RENEW_DEADLINE_MS}" ]]; then
  echo "ACORNOPS_AGENT_RETRY_PERIOD_MS must be less than or equal to ACORNOPS_AGENT_RENEW_DEADLINE_MS."
  exit 1
fi

kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${K8S_NAMESPACE}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: acornops-agentk
  namespace: ${K8S_NAMESPACE}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: acornops-agentk-role
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "services", "persistentvolumeclaims", "events", "nodes", "namespaces"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets", "replicasets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["autoscaling"]
    resources: ["horizontalpodautoscalers"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods", "nodes"]
    verbs: ["get", "list"]
  - apiGroups: ["apps"]
    resources: ["deployments", "deployments/scale", "statefulsets", "statefulsets/scale"]
    verbs: ["patch", "update"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: acornops-agentk-binding
subjects:
  - kind: ServiceAccount
    name: acornops-agentk
    namespace: ${K8S_NAMESPACE}
roleRef:
  kind: ClusterRole
  name: acornops-agentk-role
  apiGroup: rbac.authorization.k8s.io
EOF

if [[ "${ACORNOPS_AGENT_LEADER_ELECTION_ENABLED}" == "true" ]]; then
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: acornops-agentk-leader-election
  namespace: ${ACORNOPS_AGENT_LEASE_NAMESPACE}
rules:
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["get", "create", "update", "patch", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: acornops-agentk-leader-election
  namespace: ${ACORNOPS_AGENT_LEASE_NAMESPACE}
subjects:
  - kind: ServiceAccount
    name: acornops-agentk
    namespace: ${K8S_NAMESPACE}
roleRef:
  kind: Role
  name: acornops-agentk-leader-election
  apiGroup: rbac.authorization.k8s.io
EOF
fi

kubectl -n "${K8S_NAMESPACE}" create secret generic acornops-agentk-secret \
  --from-literal=agent-key="${ACORNOPS_AGENT_KEY}" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: acornops-agentk
  namespace: ${K8S_NAMESPACE}
  labels:
    app: acornops-agentk
spec:
  replicas: ${K8S_AGENT_REPLICAS}
  selector:
    matchLabels:
      app: acornops-agentk
  template:
    metadata:
      labels:
        app: acornops-agentk
    spec:
      serviceAccountName: acornops-agentk
      containers:
        - name: agent
          image: ${ACORNOPS_AGENT_IMAGE}
          imagePullPolicy: IfNotPresent
          env:
            - name: ACORNOPS_AGENT_PLATFORM_URL
              value: "${ACORNOPS_AGENT_PLATFORM_URL}"
            - name: ACORNOPS_CLUSTER_ID
              value: "${ACORNOPS_CLUSTER_ID}"
            - name: ACORNOPS_AGENT_KEY
              valueFrom:
                secretKeyRef:
                  name: acornops-agentk-secret
                  key: agent-key
            - name: ACORNOPS_AGENT_WRITE_ENABLED
              value: "${ACORNOPS_AGENT_WRITE_ENABLED}"
            - name: ACORNOPS_AGENT_LOG_LEVEL
              value: "${ACORNOPS_AGENT_LOG_LEVEL}"
            - name: ACORNOPS_AGENT_LEADER_ELECTION_ENABLED
              value: "${ACORNOPS_AGENT_LEADER_ELECTION_ENABLED}"
            - name: ACORNOPS_AGENT_LEASE_NAME
              value: "${ACORNOPS_AGENT_LEASE_NAME}"
            - name: ACORNOPS_AGENT_LEASE_NAMESPACE
              value: "${ACORNOPS_AGENT_LEASE_NAMESPACE}"
            - name: ACORNOPS_AGENT_LEASE_DURATION_MS
              value: "${ACORNOPS_AGENT_LEASE_DURATION_MS}"
            - name: ACORNOPS_AGENT_RENEW_DEADLINE_MS
              value: "${ACORNOPS_AGENT_RENEW_DEADLINE_MS}"
            - name: ACORNOPS_AGENT_RETRY_PERIOD_MS
              value: "${ACORNOPS_AGENT_RETRY_PERIOD_MS}"
            - name: ACORNOPS_AGENT_POD_NAME
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: ACORNOPS_AGENT_POD_UID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.uid
            - name: ACORNOPS_AGENT_POD_NAMESPACE
              valueFrom:
                fieldRef:
                  fieldPath: metadata.namespace
          resources:
            limits:
              cpu: 500m
              memory: 256Mi
            requests:
              cpu: 100m
              memory: 128Mi
EOF

echo "agentk deployed to namespace ${K8S_NAMESPACE}."
