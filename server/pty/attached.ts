// Sessões em segundo plano abertas no terminal interativo (`claude attach`): ~/.habblaud/attached.json guarda quais
// eram, para reabri-las quando o Habblaud reinicia (a sessão sobrevive; o attach, filho do servidor, não).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AttachedJob, AttachedStore } from './manager';

export function attachedStore(file = join(process.env.HOME || homedir(), '.habblaud', 'attached.json')): AttachedStore {
  return {
    read() {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as { jobs?: unknown };
        return Array.isArray(raw.jobs)
          ? raw.jobs.filter((j): j is AttachedJob => typeof j?.job === 'string' && typeof j?.cwd === 'string' && typeof j?.account === 'string')
          : [];
      } catch {
        return [];
      }
    },
    write(jobs) {
      try {
        mkdirSync(dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ jobs }, null, 2));
        renameSync(tmp, file);
      } catch {
        // sem disco: só não reabre depois de reiniciar
      }
    },
  };
}
