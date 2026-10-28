// Pastas que o usuário tirou da lista do "Novo agente" (o × no cartão), persistidas em <dataDir>/spawn-hidden.json.
// Esconder vale até a próxima atividade na pasta: uma sessão nova depois disso traz a pasta de volta.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { errMsg, log } from '../log';
import { pathKey } from '../model/room-aliases';
import { tr } from '../../shared/i18n';

export class HiddenFolders {
  private readonly hidden = new Map<string, number>();

  /** `file` null = só em memória (testes). */
  constructor(
    private readonly file: string | null,
    private readonly now = Date.now,
  ) {}

  load(): void {
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as { hidden?: Record<string, unknown> };
      for (const [k, v] of Object.entries(j.hidden ?? {})) if (typeof v === 'number') this.hidden.set(pathKey(k), v);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('{0} ilegível ({1}); todas as pastas voltam à lista.', [this.file, errMsg(err)]));
    }
  }

  hide(path: string): void {
    this.hidden.set(pathKey(path), this.now());
    this.save();
  }

  /** Escondida e sem atividade depois disso. */
  has(path: string, lastAt: number): boolean {
    const at = this.hidden.get(pathKey(path));
    return at !== undefined && lastAt <= at;
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(`${this.file}.tmp`, JSON.stringify({ version: 1, hidden: Object.fromEntries(this.hidden) }, null, 2));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      log.warn(tr('Não consegui gravar {0}: {1}', [this.file, errMsg(err)]));
    }
  }
}
