variable "kubeconfig_path" {type = string, default = "~/.kube/config"}
variable "kube_context" {type = string, default = null}
variable "namespace" {type = string, default = "enterprise-digital-twin"}
variable "chart_path" {type = string, default = "../../helm/enterprise-digital-twin"}
variable "runtime_secret_name" {type = string, default = "edt-runtime-secrets"}
variable "runtime_secrets" {
  type = map(string)
  sensitive = true
  description = "Secret values supplied by the deployment authority; never commit them to a tfvars file."
}
variable "image_overrides" {type = map(string), default = {}}
