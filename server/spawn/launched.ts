// Agentes em segundo plano que o Habblaud abriu (`claude --bg`): ~/.habblaud/launched.json guarda os ids, para o
// `npm run agents:stop` encerrar só esses (nunca as sessões abertas à mão), mesmo se forem renomeados.
// Node puro e sem dependências: também é importado pelo auxiliar do host (via tsx).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface LaunchedJob {
  id: string;
  folder: string;
  at: number;
}

const MAX_JOBS = 500;

export function launchedFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME || homedir(), '.habblaud', 'launched.json');
}

export function readLaunched(file = launchedFile()): LaunchedJob[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { jobs?: unknown };
    return Array.isArray(raw.jobs) ? raw.jobs.filter((j): j is LaunchedJob => typeof j?.id === 'string' && typeof j?.folder === 'string' && typeof j?.at === 'number') : [];
  } catch {
    return [];
  }
}

export function writeLaunched(jobs: readonly LaunchedJob[], file = launchedFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ jobs: jobs.slice(-MAX_JOBS) }, null, 2));
  renameSync(tmp, file);
}

/** Anota um agente aberto pelo Habblaud. Falhar aqui não impede o agente: só fica fora do `agents:stop`. */
export function recordLaunched(job: Omit<LaunchedJob, 'at'>, file = launchedFile(), now = Date.now()): void {
  try {
    writeLaunched([...readLaunched(file).filter((j) => j.id !== job.id), { ...job, at: now }], file);
  } catch {
    // sem disco: segue sem anotar
  }
}
