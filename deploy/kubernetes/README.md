# Kubernetes deployment

`base/` deploys one active Agent RPC replica and one Pi Agent Web replica. Both Services are `ClusterIP`; only the example Traefik `IngressRoute` exposes Web. Agent RPC is protected by a `NetworkPolicy` that admits port 8080 only from Pods labeled `app.kubernetes.io/name=pi-agent-web`.

## Required external objects

Create these before applying the base:

- Secret `pi-agent-rpc-token` with key `pi-agent-rpc-token`.
- PVC `pi-agent-workspace` for `/app`.
- PVC `pi-agent-data` for `/home/node/.pi`.

Example Secret creation without putting its value in a manifest or shell argument:

```sh
umask 077
openssl rand -hex 32 >pi-agent-rpc-token
kubectl create secret generic pi-agent-rpc-token --from-file=pi-agent-rpc-token
rm -f pi-agent-rpc-token
```

The Secret volume uses mode `0440` (`defaultMode: 288`) and Pod `fsGroup: 1000`. Its key is mounted with `subPath` so the runtime's no-follow check sees a regular file; restart both Deployments after rotating the Secret. Do not commit Secret data. Use a Kustomize overlay to replace PVC names, image registries, namespace, and Traefik host for the target environment.

```sh
kubectl kustomize deploy/kubernetes/base
kubectl apply -k deploy/kubernetes/base
kubectl apply -f deploy/kubernetes/traefik/ingressroute.example.yaml
```

Do not create an Ingress, NodePort, LoadBalancer, `hostPort`, or `hostNetwork` for `pi-agent-rpc`. Agent uses `Recreate` to prevent overlapping writable replicas; stop the existing writer before cutover.
