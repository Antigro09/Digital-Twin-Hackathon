{{- define "edt.name" -}}
enterprise-digital-twin
{{- end -}}

{{- define "edt.fullname" -}}
{{- printf "%s" (include "edt.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "edt.labels" -}}
app.kubernetes.io/name: {{ include "edt.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end -}}

{{- define "edt.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "edt.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}
