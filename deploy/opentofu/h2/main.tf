provider "kubernetes" {
  config_path = pathexpand(var.kubeconfig_path)
  config_context = var.kube_context
}

provider "helm" {
  kubernetes = {
    config_path = pathexpand(var.kubeconfig_path)
    config_context = var.kube_context
  }
}

resource "kubernetes_namespace_v1" "edt" {
  metadata {
    name = var.namespace
    labels = {"app.kubernetes.io/part-of" = "enterprise-digital-twin"}
  }
}

resource "kubernetes_secret_v1" "runtime" {
  metadata {
    name = var.runtime_secret_name
    namespace = kubernetes_namespace_v1.edt.metadata[0].name
  }
  type = "Opaque"
  data = var.runtime_secrets
}

resource "helm_release" "edt" {
  name = "edt"
  namespace = kubernetes_namespace_v1.edt.metadata[0].name
  chart = abspath(var.chart_path)
  atomic = true
  cleanup_on_fail = true
  wait = true
  timeout = 900

  values = [yamlencode({
    global = {existingSecret = kubernetes_secret_v1.runtime.metadata[0].name}
    images = var.image_overrides
  })]

  depends_on = [kubernetes_secret_v1.runtime]
}
