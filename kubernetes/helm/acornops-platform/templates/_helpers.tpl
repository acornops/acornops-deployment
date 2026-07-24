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

{{/* Resolve a component override, falling back to the global additive CA bundle. */}}
{{- define "acornops-platform.additionalCaBundle" -}}
{{- $bundle := .root.Values.global.trust.additionalCaBundle -}}
{{- $componentValues := index .root.Values.components .component -}}
{{- $componentBundle := $componentValues.trust.additionalCaBundle -}}
{{- if or (kindIs "map" $componentBundle.configMapKeyRef) (kindIs "map" $componentBundle.secretKeyRef) -}}
{{- $bundle = $componentBundle -}}
{{- end -}}
{{- toYaml $bundle -}}
{{- end -}}

{{/* Validate and report whether an effective component CA bundle is configured. */}}
{{- define "acornops-platform.additionalCaEnabled" -}}
{{- $bundle := include "acornops-platform.additionalCaBundle" . | fromYaml -}}
{{- $configMapRef := $bundle.configMapKeyRef -}}
{{- $secretKeyRef := $bundle.secretKeyRef -}}
{{- $hasConfigMapRef := kindIs "map" $configMapRef -}}
{{- $hasSecretKeyRef := kindIs "map" $secretKeyRef -}}
{{- if and $hasConfigMapRef $hasSecretKeyRef -}}
{{- fail (printf "effective additional CA bundle for components.%s must configure only one of configMapKeyRef or secretKeyRef" .component) -}}
{{- end -}}
{{- if $hasConfigMapRef -}}
{{- $_ := required "additionalCaBundle.configMapKeyRef.name is required when configMapKeyRef is configured" $configMapRef.name -}}
{{- $_ := required "additionalCaBundle.configMapKeyRef.key is required when configMapKeyRef is configured" $configMapRef.key -}}
true
{{- else if $hasSecretKeyRef -}}
{{- $_ := required "additionalCaBundle.secretKeyRef.name is required when secretKeyRef is configured" $secretKeyRef.name -}}
{{- $_ := required "additionalCaBundle.secretKeyRef.key is required when secretKeyRef is configured" $secretKeyRef.key -}}
true
{{- end -}}
{{- end -}}

{{/* Fixed path shared by all runtimes and migration jobs. */}}
{{- define "acornops-platform.additionalCaPath" -}}
/etc/acornops/trust/additional-ca.pem
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

{{/* Validate and serialize the deployment-wide provider/model policy. */}}
{{- define "acornops-platform.llmProvidersJson" -}}
{{- $provider := .Values.ai.defaultProvider -}}
{{- $model := .Values.ai.defaultModel -}}
{{- if not (hasKey .Values.ai.providers $provider) -}}
{{- fail (printf "ai.defaultProvider %q must be configured in ai.providers" $provider) -}}
{{- end -}}
{{- $models := index .Values.ai.providers $provider -}}
{{- if not (has $model $models) -}}
{{- fail (printf "ai.defaultModel %q must be configured under ai.providers.%s" $model $provider) -}}
{{- end -}}
{{- toJson .Values.ai.providers -}}
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
