import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { load as loadYaml } from "js-yaml";

const webRoot = new URL("../", import.meta.url).pathname;
const rpcRoot = process.env.PI_AGENT_RPC_ROOT ?? resolve(webRoot, "../pi-agent-rpc");

async function yaml(root, path) {
  return loadYaml(await readFile(join(root, path), "utf8"));
}

async function renderBase(root, directory) {
  const kustomization = await yaml(root, `${directory}/kustomization.yaml`);
  return Promise.all(kustomization.resources.map((resource) => yaml(root, `${directory}/${resource}`)));
}

function container(deployment) {
  assert.equal(deployment.kind, "Deployment");
  assert.equal(deployment.spec.template.spec.containers.length, 1);
  return deployment.spec.template.spec.containers[0];
}

function assertSafePod(deployment) {
  const pod = deployment.spec.template.spec;
  const app = container(deployment);
  assert.equal(pod.securityContext.fsGroup, 1000);
  assert.deepEqual(pod.securityContext.seccompProfile, { type: "RuntimeDefault" });
  assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.enableServiceLinks, false);
  assert.equal(app.securityContext.runAsNonRoot, true);
  assert.equal(app.securityContext.runAsUser, 1000);
  assert.equal(app.securityContext.runAsGroup, 1000);
  assert.equal(app.securityContext.allowPrivilegeEscalation, false);
  assert.deepEqual(app.securityContext.capabilities.drop, ["ALL"]);
  const secretMount = app.volumeMounts.find((mount) => mount.name === "rpc-token");
  assert.deepEqual(secretMount, { name: "rpc-token", mountPath: "/run/secrets/pi-agent-rpc-token", subPath: "pi-agent-rpc-token", readOnly: true });
  const secret = pod.volumes.find((volume) => volume.name === "rpc-token");
  assert.equal(secret.secret.secretName, "pi-agent-rpc-token");
  assert.equal(secret.secret.defaultMode, 288);
  assert.equal(secret.secret.optional, false);
  for (const variable of app.env ?? []) {
    assert.equal(variable.valueFrom, undefined);
    assert.equal(/(?:^|_)TOKEN$/.test(variable.name), false);
  }
  assert.equal(pod.hostNetwork, undefined);
  assert.equal(app.ports.some((port) => port.hostPort !== undefined), false);
  assert.equal(app.securityContext.privileged, undefined);
}

function assertAgentDeployment(deployment) {
  assert.equal(deployment.metadata.name, "pi-agent-rpc");
  assert.equal(deployment.spec.replicas, 1);
  assert.equal(deployment.spec.strategy.type, "Recreate");
  assert.equal(deployment.spec.template.spec.terminationGracePeriodSeconds, 60);
  assertSafePod(deployment);
  const app = container(deployment);
  assert.equal(app.image, "pi-agent-rpc:0.1.0");
  assert.deepEqual(app.ports, [{ name: "rpc", containerPort: 8080, protocol: "TCP" }]);
  assert.equal(app.env.find((entry) => entry.name === "PI_AGENT_RPC_TOKEN_FILE")?.value, "/run/secrets/pi-agent-rpc-token");
  assert.deepEqual(app.volumeMounts.filter((mount) => mount.name !== "rpc-token"), [
    { name: "workspace", mountPath: "/app" },
    { name: "pi-data", mountPath: "/home/node/.pi" },
  ]);
  const volumes = deployment.spec.template.spec.volumes;
  assert.equal(volumes.find((volume) => volume.name === "workspace")?.persistentVolumeClaim.claimName, "pi-agent-workspace");
  assert.equal(volumes.find((volume) => volume.name === "pi-data")?.persistentVolumeClaim.claimName, "pi-agent-data");
  assert.equal(app.livenessProbe.httpGet.path, "/internal/v1/health/live");
  assert.equal(app.livenessProbe.httpGet.httpHeaders, undefined);
  assert.equal(app.readinessProbe.httpGet, undefined);
  const command = app.readinessProbe.exec.command;
  assert.deepEqual(command.slice(0, 2), ["node", "-e"]);
  assert.match(command[2], /\/run\/secrets\/pi-agent-rpc-token/);
  assert.match(command[2], /\/internal\/v1\/health\/ready/);
  assert.match(command[2], /authorization/);
}

function assertAgentService(service) {
  assert.equal(service.kind, "Service");
  assert.equal(service.metadata.name, "pi-agent-rpc");
  assert.equal(service.spec.type, "ClusterIP");
  assert.deepEqual(service.spec.ports, [{ name: "rpc", port: 8080, targetPort: "rpc", protocol: "TCP" }]);
}

test("RPC repository provides a single-active internal Agent Kubernetes base", async () => {
  const base = "deploy/kubernetes/base";
  assertAgentDeployment(await yaml(rpcRoot, `${base}/deployment.yaml`));
  assertAgentService(await yaml(rpcRoot, `${base}/service.yaml`));
  const kustomization = await yaml(rpcRoot, `${base}/kustomization.yaml`);
  assert.deepEqual(kustomization.resources, ["deployment.yaml", "service.yaml"]);
});

test("Web repository Kubernetes base deploys Agent data only on Agent and rolls Web safely", async () => {
  const base = "deploy/kubernetes/base";
  const agent = await yaml(webRoot, `${base}/agent-deployment.yaml`);
  const agentService = await yaml(webRoot, `${base}/agent-service.yaml`);
  const web = await yaml(webRoot, `${base}/web-deployment.yaml`);
  const webService = await yaml(webRoot, `${base}/web-service.yaml`);
  assertAgentDeployment(agent);
  assertAgentService(agentService);
  assert.equal(web.metadata.name, "pi-agent-web");
  assert.equal(web.spec.replicas, 1);
  assert.deepEqual(web.spec.strategy, { type: "RollingUpdate", rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } });
  assertSafePod(web);
  const app = container(web);
  assert.equal(app.image, "pi-agent-web:0.1.0");
  assert.deepEqual(app.ports, [{ name: "http", containerPort: 30141, protocol: "TCP" }]);
  assert.equal(app.env.find((entry) => entry.name === "PI_AGENT_RPC_URL")?.value, "http://pi-agent-rpc:8080");
  assert.equal(app.env.find((entry) => entry.name === "PI_AGENT_RPC_TOKEN_FILE")?.value, "/run/secrets/pi-agent-rpc-token");
  assert.deepEqual(web.spec.template.spec.volumes.map((volume) => volume.name), ["rpc-token"]);
  assert.equal(app.livenessProbe.httpGet.path, "/api/health/live");
  assert.equal(app.readinessProbe.httpGet.path, "/api/health/ready");
  assert.equal(webService.spec.type, "ClusterIP");
  assert.deepEqual(webService.spec.ports, [{ name: "http", port: 30141, targetPort: "http", protocol: "TCP" }]);
  const kustomization = await yaml(webRoot, `${base}/kustomization.yaml`);
  assert.deepEqual(kustomization.resources, ["agent-deployment.yaml", "agent-service.yaml", "web-deployment.yaml", "web-service.yaml", "network-policy.yaml"]);
});

test("NetworkPolicy and Traefik expose only Web while admitting Web to Agent 8080", async () => {
  const policy = await yaml(webRoot, "deploy/kubernetes/base/network-policy.yaml");
  assert.equal(policy.kind, "NetworkPolicy");
  assert.deepEqual(policy.spec.podSelector.matchLabels, { "app.kubernetes.io/name": "pi-agent-rpc" });
  assert.deepEqual(policy.spec.policyTypes, ["Ingress"]);
  assert.deepEqual(policy.spec.ingress, [{ from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "pi-agent-web" } } }], ports: [{ protocol: "TCP", port: 8080 }] }]);
  const ingress = await yaml(webRoot, "deploy/kubernetes/traefik/ingressroute.example.yaml");
  assert.equal(ingress.kind, "IngressRoute");
  const services = ingress.spec.routes.flatMap((route) => route.services);
  assert.deepEqual(services, [{ name: "pi-agent-web", port: 30141 }]);
});

test("Kustomize bases render every declared resource without external tooling", async () => {
  const rpc = await renderBase(rpcRoot, "deploy/kubernetes/base");
  const web = await renderBase(webRoot, "deploy/kubernetes/base");
  assert.deepEqual(rpc.map((resource) => `${resource.kind}/${resource.metadata.name}`), [
    "Deployment/pi-agent-rpc", "Service/pi-agent-rpc",
  ]);
  assert.deepEqual(web.map((resource) => `${resource.kind}/${resource.metadata.name}`), [
    "Deployment/pi-agent-rpc", "Service/pi-agent-rpc", "Deployment/pi-agent-web", "Service/pi-agent-web", "NetworkPolicy/pi-agent-rpc-ingress",
  ]);
});

test("Kubernetes templates contain no Secret data or unsafe host access", async () => {
  const roots = [
    [rpcRoot, ["deploy/kubernetes/base/deployment.yaml", "deploy/kubernetes/base/service.yaml", "deploy/kubernetes/base/kustomization.yaml"]],
    [webRoot, ["deploy/kubernetes/base/agent-deployment.yaml", "deploy/kubernetes/base/agent-service.yaml", "deploy/kubernetes/base/web-deployment.yaml", "deploy/kubernetes/base/web-service.yaml", "deploy/kubernetes/base/network-policy.yaml", "deploy/kubernetes/base/kustomization.yaml", "deploy/kubernetes/traefik/ingressroute.example.yaml"]],
  ];
  for (const [root, paths] of roots) {
    for (const path of paths) {
      const source = await readFile(join(root, path), "utf8");
      assert.doesNotMatch(source, /kind:\s*Secret|\bstringData:|\bhostPath:|\bhostNetwork:|\bhostPort:|privileged:\s*true/);
    }
  }
});
