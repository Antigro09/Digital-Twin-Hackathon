output "namespace" {value = kubernetes_namespace_v1.edt.metadata[0].name}
output "release_name" {value = helm_release.edt.name}
output "release_status" {value = helm_release.edt.status}
