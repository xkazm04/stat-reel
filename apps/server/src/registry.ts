import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Source, SourceSchema, type UseCase, UseCaseSchema } from "@statreel/schemas";
import { parse } from "yaml";
import { paths } from "./config";

export function loadRegistry(): { sources: Source[]; usecases: UseCase[] } {
  const sources = (parse(readFileSync(paths.registry, "utf8")) as unknown[]).map((s) => SourceSchema.parse(s));
  const usecases = readdirSync(paths.usecases)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => UseCaseSchema.parse(parse(readFileSync(path.join(paths.usecases, f), "utf8"))));
  return { sources, usecases };
}
