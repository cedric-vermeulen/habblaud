// npm run agents:stop — encerra os agentes em segundo plano que o Habblaud abriu (~/.habblaud/launched.json), com
// `claude stop`: a conversa fica guardada (`claude attach <id>` ou `claude --resume` a reabre). Sessões abertas à mão
// nunca são tocadas. Tira da lista os que já não rodam.
import { execFileSync } from 'node:child_process';
import { runnableClaudeBin } from '../server/claude-bin';
import { readLaunched, writeLaunched, type LaunchedJob } from '../server/spawn/launched';
import { tr } from '../shared/i18n';

const bin = runnableClaudeBin(process.env);
if (!bin) {
  console.error(`[agents:stop] ${tr('claude não encontrado (HABBLAUD_CLAUDE_BIN ou PATH).')}`);
  process.exit(1);
}

const running = new Set(
  (JSON.parse(execFileSync(bin, ['agents', '--json'], { encoding: 'utf8', windowsHide: true })) as { id?: string }[])
    .map((a) => a.id)
    .filter((id): id is string => !!id),
);
const launched = readLaunched();
const kept: LaunchedJob[] = [];
let stopped = 0;
for (const job of launched) {
  if (!running.has(job.id)) continue;
  try {
    execFileSync(bin, ['stop', job.id], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    console.log(`[agents:stop] ${tr('encerrado {0} ({1})', [job.id, job.folder])}`);
    stopped++;
  } catch (err) {
    console.error(`[agents:stop] ${tr('falha ao encerrar {0}: {1}', [job.id, (err as Error).message.split('\n')[0]])}`);
    kept.push(job);
  }
}
writeLaunched(kept);
console.log(`[agents:stop] ${tr('{0} agente(s) encerrado(s), {1} já parado(s).', [stopped, launched.length - stopped - kept.length])}`);
