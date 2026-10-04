export function portCollisionMessage(port: string | number, label?: string): string;
export function portInUse(port: string | number, host?: string, timeoutMs?: number): boolean;
export function ffprobeMessage(): string;
export function chromeMessage(candidates: string[]): string;
export function warehousePath(env?: Record<string, string | undefined>, root?: string): string;
export function warehouseMessage(file: string): string;
export function audioFixturesDir(root?: string): string;
export function audioFixturesMessage(dir: string): string;
export function e2eModes(env?: Record<string, string | undefined>): {
  LLM_MODE: string;
  AUDIO_MODE: string;
  PUBLISH_MODE: string;
  GEN_MODE: string;
  LLM_RECORD: string;
  AUDIO_RECORD: string;
};
export function chromeCandidates(platform?: string, env?: Record<string, string | undefined>): string[];
export function preflightProblems(
  ports: { apiPort: string | number; studioPort: string | number },
  deps?: {
    portInUse?: (port: string | number) => boolean;
    ffprobeOk?: () => boolean;
    exists?: (p: string) => boolean;
    candidates?: string[];
    warehouse?: string;
    audioDir?: string;
    audioMode?: string;
    audioFiles?: (dir: string) => string[];
  },
): string[];
export function pruneCandidates(files: string[], currentDb: string, keep?: number): string[];
export function pruneRunDbs(dir: string, currentDb: string, keep?: number): { removed: string[]; skipped: string[] };
