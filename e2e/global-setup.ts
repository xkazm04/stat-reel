import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

/** Fresh app state per e2e run; the warehouse and caches are reused (read-only / content-addressed). */
export default function globalSetup() {
  const dir = path.resolve("data", "e2e");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}
