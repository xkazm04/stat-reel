export function portCollisionMessage(port: string | number, label?: string): string;
export function portInUse(port: string | number, host?: string, timeoutMs?: number): boolean;
export function ffprobeMessage(): string;
export function chromeMessage(candidates: string[]): string;
export function chromeCandidates(platform?: string, env?: Record<string, string | undefined>): string[];
export function preflightProblems(
  ports: { apiPort: string | number; studioPort: string | number },
  deps?: {
    portInUse?: (port: string | number) => boolean;
    ffprobeOk?: () => boolean;
    exists?: (p: string) => boolean;
    candidates?: string[];
  },
): string[];
export function pruneCandidates(files: string[], currentDb: string, keep?: number): string[];
export function pruneRunDbs(dir: string, currentDb: string, keep?: number): { removed: string[]; skipped: string[] };
