import { mkdirSync } from "node:fs";
import path from "node:path";

/** Each run gets its own app DB (see playwright.config.ts); the warehouse and caches are reused. */
export default function globalSetup() {
  mkdirSync(path.resolve("data", "e2e"), { recursive: true });
}
