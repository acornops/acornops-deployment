{{/*
Expand the name of the chart.
*/}}
{{- define "acornops-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "acornops-platform.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "acornops-platform.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "acornops-platform.labels" -}}
helm.sh/chart: {{ include "acornops-platform.chart" . }}
app.kubernetes.io/name: {{ include "acornops-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.global.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "acornops-platform.selectorLabels" -}}
app.kubernetes.io/name: {{ include "acornops-platform.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "acornops-platform.componentLabels" -}}
{{ include "acornops-platform.labels" .root }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "acornops-platform.componentFullname" -}}
{{- printf "%s-%s" (include "acornops-platform.fullname" .root) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "acornops-platform.image" -}}
{{- $tag := default .root.Chart.AppVersion .image.tag -}}
{{- printf "%s:%s" .image.repository $tag -}}
{{- end -}}

{{- define "acornops-platform.secretName" -}}
{{- required "secrets.existingSecretName is required" .Values.secrets.existingSecretName -}}
{{- end -}}

{{- define "acornops-platform.publicUrl" -}}
{{- required "platform.publicUrl is required" .Values.platform.publicUrl | trimSuffix "/" -}}
{{- end -}}

{{- define "acornops-platform.managementConsoleUrl" -}}
{{- required "platform.consoleUrl is required" .Values.platform.consoleUrl | trimSuffix "/" -}}
{{- end -}}

{{- define "acornops-platform.pathWithTrailingSlash" -}}
{{- $path := default "/" . -}}
{{- if eq $path "/" -}}
/
{{- else -}}
{{- printf "%s/" (trimSuffix "/" $path) -}}
{{- end -}}
{{- end -}}

{{- define "acornops-platform.ingressPath" -}}
{{- $path := default "/" . -}}
{{- if eq $path "/" -}}
/
{{- else -}}
{{- trimSuffix "/" $path -}}
{{- end -}}
{{- end -}}

{{/* Validate and report whether an additional OIDC CA bundle is configured. */}}
{{- define "acornops-platform.oidcAdditionalCaEnabled" -}}
{{- $bundle := .Values.auth.oidc.tls.additionalCaBundle -}}
{{- $configMapRef := $bundle.configMapKeyRef -}}
{{- $secretKeyRef := $bundle.secretKeyRef -}}
{{- $hasConfigMapRef := kindIs "map" $configMapRef -}}
{{- $hasSecretKeyRef := kindIs "map" $secretKeyRef -}}
{{- if and $hasConfigMapRef $hasSecretKeyRef -}}
{{- fail "auth.oidc.tls.additionalCaBundle must configure only one of configMapKeyRef or secretKeyRef" -}}
{{- end -}}
{{- if $hasConfigMapRef -}}
{{- $_ := required "auth.oidc.tls.additionalCaBundle.configMapKeyRef.name is required when configMapKeyRef is configured" $configMapRef.name -}}
{{- $_ := required "auth.oidc.tls.additionalCaBundle.configMapKeyRef.key is required when configMapKeyRef is configured" $configMapRef.key -}}
true
{{- else if $hasSecretKeyRef -}}
{{- $_ := required "auth.oidc.tls.additionalCaBundle.secretKeyRef.name is required when secretKeyRef is configured" $secretKeyRef.name -}}
{{- $_ := required "auth.oidc.tls.additionalCaBundle.secretKeyRef.key is required when secretKeyRef is configured" $secretKeyRef.key -}}
true
{{- end -}}
{{- end -}}

{{/* Fixed file path consumed by Node.js for the additional OIDC CA bundle. */}}
{{- define "acornops-platform.oidcAdditionalCaPath" -}}
/etc/acornops/trust/oidc-ca.pem
{{- end -}}

{{/* Validate and report whether an MCP egress trust bundle is configured. */}}
{{- define "acornops-platform.mcpEgressCaEnabled" -}}
{{- $bundle := .Values.components.llmGateway.mcpEgress.caBundle -}}
{{- $configMapRef := $bundle.configMapKeyRef -}}
{{- $secretKeyRef := $bundle.secretKeyRef -}}
{{- $hasConfigMapRef := kindIs "map" $configMapRef -}}
{{- $hasSecretKeyRef := kindIs "map" $secretKeyRef -}}
{{- if and $hasConfigMapRef $hasSecretKeyRef -}}
{{- fail "components.llmGateway.mcpEgress.caBundle must configure only one of configMapKeyRef or secretKeyRef" -}}
{{- end -}}
{{- if $hasConfigMapRef -}}
{{- $_ := required "components.llmGateway.mcpEgress.caBundle.configMapKeyRef.name is required when configMapKeyRef is configured" $configMapRef.name -}}
{{- $_ := required "components.llmGateway.mcpEgress.caBundle.configMapKeyRef.key is required when configMapKeyRef is configured" $configMapRef.key -}}
true
{{- else if $hasSecretKeyRef -}}
{{- $_ := required "components.llmGateway.mcpEgress.caBundle.secretKeyRef.name is required when secretKeyRef is configured" $secretKeyRef.name -}}
{{- $_ := required "components.llmGateway.mcpEgress.caBundle.secretKeyRef.key is required when secretKeyRef is configured" $secretKeyRef.key -}}
true
{{- end -}}
{{- end -}}

{{/* Fixed file path consumed by HTTPX/OpenSSL for remote MCP TLS trust. */}}
{{- define "acornops-platform.mcpEgressCaPath" -}}
/etc/acornops/trust/mcp-egress-ca-bundle.pem
{{- end -}}

{{- define "acornops-platform.internalTlsEnabled" -}}
{{- if .Values.internalTransport.tls.enabled }}true{{ else }}false{{ end -}}
{{- end -}}

{{- define "acornops-platform.internalTlsMountPath" -}}
{{- trimSuffix "/" .Values.internalTransport.tls.mountPath -}}
{{- end -}}

{{- define "acornops-platform.internalTlsCaFile" -}}
{{- printf "%s/ca/%s" (include "acornops-platform.internalTlsMountPath" .) .Values.internalTransport.tls.ca.key -}}
{{- end -}}

{{- define "acornops-platform.internalTlsCertFile" -}}
{{- printf "%s/%s/%s" (include "acornops-platform.internalTlsMountPath" .root) .component .certKey -}}
{{- end -}}

{{- define "acornops-platform.internalTlsKeyFile" -}}
{{- printf "%s/%s/%s" (include "acornops-platform.internalTlsMountPath" .root) .component .keyKey -}}
{{- end -}}

{{- define "acornops-platform.internalHost" -}}
{{- if .root.Values.internalTransport.tls.enabled -}}
{{- printf "%s.%s.svc" (include "acornops-platform.componentFullname" (dict "root" .root "component" .component)) .root.Release.Namespace -}}
{{- else -}}
{{- include "acornops-platform.componentFullname" (dict "root" .root "component" .component) -}}
{{- end -}}
{{- end -}}

{{- define "acornops-platform.internalUrl" -}}
{{- $scheme := ternary "https" "http" .root.Values.internalTransport.tls.enabled -}}
{{- printf "%s://%s:%v" $scheme (include "acornops-platform.internalHost" (dict "root" .root "component" .component)) .port -}}
{{- end -}}

{{- define "acornops-platform.controlPlaneInternalUrl" -}}
{{- if .Values.internalTransport.tls.enabled -}}
{{- include "acornops-platform.internalUrl" (dict "root" . "component" "control-plane" "port" .Values.internalTransport.tls.controlPlane.internalPort) -}}
{{- else -}}
{{- include "acornops-platform.internalUrl" (dict "root" . "component" "control-plane" "port" .Values.components.controlPlane.service.port) -}}
{{- end -}}
{{- end -}}

{{- define "acornops-platform.workloadScheduling" -}}
{{- with .values.priorityClassName }}
priorityClassName: {{ . | quote }}
{{- end }}
{{- with .values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .values.topologySpreadConstraints }}
topologySpreadConstraints:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
