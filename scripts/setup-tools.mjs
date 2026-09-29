// Fetch machine-local tools into .tools/ (gitignored): OPA, and on Windows-on-ARM an x64 Node for
// the Remotion render worker (ADR 004). Idempotent.
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const tools = path.join(root, ".tools");
mkdirSync(tools, { recursive: true });

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

const win = process.platform === "win32";
const opa = path.join(tools, win ? "opa.exe" : "opa");
if (!existsSync(opa)) {
  const asset = win ? "opa_windows_amd64.exe" : process.platform === "darwin" ? `opa_darwin_${process.arch === "arm64" ? "arm64" : "amd64"}_static` : `opa_linux_${process.arch === "arm64" ? "arm64" : "amd64"}_static`;
  console.log(`fetching OPA (${asset})`);
  await download(`https://openpolicyagent.org/downloads/latest/${asset}`, opa);
  if (!win) execFileSync("chmod", ["+x", opa]);
}

if (win && process.arch === "arm64" && !existsSync(path.join(tools, "node-x64", "node.exe"))) {
  const version = "v22.23.3";
  const zip = path.join(tools, "node-x64.zip");
  console.log(`fetching Node ${version} win-x64 for the render worker (ADR 004)`);
  await download(`https://nodejs.org/dist/${version}/node-${version}-win-x64.zip`, zip);
  execFileSync("tar", ["-xf", zip, "-C", tools]);
  renameSync(path.join(tools, `node-${version}-win-x64`), path.join(tools, "node-x64"));
  rmSync(zip);
}
console.log("tools ready:", execFileSync(opa, ["version"]).toString().split("\n")[0]);
