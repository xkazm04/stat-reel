// Store a secret in the OS keychain (service "statreel"). The value is read from stdin, never argv.
//   just secrets-set elevenlabs      (paste the key, Enter)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const name = process.argv[2];
if (!name) {
  console.error("usage: node scripts/secrets-set.mjs <name>");
  process.exit(2);
}
// anchored to this file, not the cwd: the keyring package is the server's dependency, wherever this is run from
const req = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "server", "package.json"));
const { Entry } = req("@napi-rs/keyring");
process.stdout.write(`value for '${name}' (input is not echoed to logs; press Enter): `);
let value = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  value += chunk;
  if (value.includes("\n")) break;
}
value = value.trim();
if (!value) {
  console.error("\nempty value, nothing stored");
  process.exit(1);
}
new Entry("statreel", name).setPassword(value);
console.log(`\nstored '${name}' (${value.length} chars) in the OS keychain`);
process.exit(0);
