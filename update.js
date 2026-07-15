/* eslint-disable @typescript-eslint/no-require-imports */
const { exec, execSync } = require("child_process");

const serverId = "051fffd8-cc30-45e8-add9-1242c2aa313c";
const pteroKey = "ptlc_9N3bHENtXp3uEaL1zntaFBBQGRpP2dILZsQsbfUzWTW";
const pteroPanelUrl = "https://panel.datta.dev";

const deployWebhookUrl = "http://104.250.132.30:8787/deploy";
const deployWebhookToken = "tabtap-blue-green-deploy";
const deployProject = "bluegreen-hello-next";
const deployWait = true;
const deployTimeoutMs = 10 * 60 * 1000;

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Error ejecutando comando: ${cmd}\n${error.message}`));
        return;
      }
      if (stderr) console.warn(`STDERR en "${cmd}":\n${stderr}`);
      console.log(`Comando ejecutado: ${cmd}`);
      if (stdout) console.log(stdout.trim());
      resolve();
    });
  });
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function getGitValue(command, fallback = "") { try { return execSync(command, { encoding: "utf8" }).trim() || fallback; } catch { return fallback; } }
function getRemoteDefaultBranch() { const output = execSync("git remote show origin", { encoding: "utf8" }); return output.match(/HEAD branch: (.+)/)?.[1]?.trim() || "main"; }
function getRemoteUrl() { return getGitValue("git remote get-url origin").replace(/https:\/\/([^:@]+):([^@]+)@/i, "https://$1:***@"); }
async function postJson(url, payload, headers = {}) { const response = await fetch(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) }); const body = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : await response.text(); if (!response.ok) throw new Error(`Deploy webhook ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`); return body; }
async function getJson(url, headers = {}) { const response = await fetch(url, { headers: { Accept: "application/json", ...headers } }); const body = (response.headers.get("content-type") || "").includes("application/json") ? await response.json() : await response.text(); if (!response.ok) throw new Error(`Deploy status ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`); return body; }
function deployState(payload) { return payload?.state || payload?.status || payload?.data?.state || payload?.data?.status || ""; }
async function waitForWebhookDeploy(initialResult, headers) { const statusUrl = initialResult?.statusUrl || initialResult?.data?.statusUrl; if (!deployWait || !statusUrl) return initialResult; console.log(`Deploy en segundo plano iniciado. Esperando estado: ${statusUrl}`); const started = Date.now(); while (Date.now() - started < deployTimeoutMs) { await wait(3000); const status = await getJson(statusUrl, headers); const state = String(deployState(status)).toLowerCase(); if (state) console.log(`Estado deploy: ${state}`); if (["ready", "success", "completed", "complete"].includes(state)) return status; if (["failed", "error", "cancelled", "canceled"].includes(state)) throw new Error(`Deploy fallido: ${JSON.stringify(status)}`); } throw new Error("Deploy webhook excedio el tiempo maximo de espera."); }
async function triggerWebhookDeploy({ branch, remoteDefaultBranch, commit }) { const headers = deployWebhookToken ? { Authorization: `Bearer ${deployWebhookToken}` } : {}; const payload = { project: deployProject, repository: getRemoteUrl(), branch: remoteDefaultBranch, sourceBranch: branch, commit, pterodactylServerId: serverId, mode: "blue-green", requestedAt: new Date().toISOString() }; console.log(`Solicitando deploy blue-green en VPS para ${deployProject} (${commit.slice(0, 7)}).`); const result = await postJson(deployWebhookUrl, payload, headers); await waitForWebhookDeploy(result, headers); console.log("Deploy webhook completado correctamente."); return true; }
async function triggerPterodactylDeploy(targetServerId, apiKey) { if (!apiKey) throw new Error("Falta PTERO_KEY."); const response = await fetch(`${pteroPanelUrl}/api/client/servers/${targetServerId}/power`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ signal: "restart" }) }); if (!response.ok) throw new Error(`Error en Pterodactyl: ${response.status} - ${await response.text()}`); console.log("Servidor reiniciado correctamente en Pterodactyl."); }

async function main() {
  try {
    const currentBranch = getGitValue("git branch --show-current");
    const remoteDefaultBranch = getRemoteDefaultBranch();
    if (!currentBranch) throw new Error("No se pudo detectar la rama actual de git.");
    for (const cmd of ["git add .", 'git commit -m "changes"', `git push origin ${currentBranch}:${remoteDefaultBranch} --force`]) { await runCommand(cmd); await wait(100); }
    const commit = getGitValue("git rev-parse HEAD");
    const usedWebhook = await triggerWebhookDeploy({ branch: currentBranch, remoteDefaultBranch, commit });
    if (usedWebhook) return;
    await triggerPterodactylDeploy(serverId, pteroKey);
  } catch (error) { console.error(error.message); process.exit(1); }
}
main();