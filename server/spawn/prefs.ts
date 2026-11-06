// Preferências da lista do "Novo agente", persistidas em <dataDir>/spawn-folders.json: pastas tiradas da lista (o ×,
// vale até a próxima atividade na pasta) e pastas favoritas (a estrela: ficam sempre no topo, mesmo sem sessão recente).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { errMsg, log } from '../log';
import { pathKey } from '../model/room-aliases';
import { tr } from '../../shared/i18n';

interface PrefsFile {
  hidden?: Record<string, unknown>;
  starred?: unknown;
}

export class FolderPrefs {
  private readonly hidden = new Map<string, number>();
  /** pathKey -> caminho como o usuário marcou. */
  private readonly starred = new Map<string, string>();

  /** `file` null = só em memória (testes). */
  constructor(
    private readonly file: string | null,
    private readonly now = Date.now,
  ) {}

  load(): void {
    if (!this.file) return;
    const j = this.read(this.file) ?? this.read(join(dirname(this.file), 'spawn-hidden.json'));
    for (const [k, v] of Object.entries(j?.hidden ?? {})) if (typeof v === 'number') this.hidden.set(pathKey(k), v);
    if (Array.isArray(j?.starred)) for (const p of j.starred) if (typeof p === 'string' && p.trim()) this.starred.set(pathKey(p), p);
  }

  hide(path: string): void {
    this.hidden.set(pathKey(path), this.now());
    this.starred.delete(pathKey(path));
    this.save();
  }

  star(path: string, on: boolean): void {
    const key = pathKey(path);
    if (on) {
      this.starred.set(key, path.trim().replace(/[\\/]+$/, ''));
      this.hidden.delete(key);
    } else this.starred.delete(key);
    this.save();
  }

  /** Escondida e sem atividade depois disso. */
  isHidden(path: string, lastAt: number): boolean {
    const at = this.hidden.get(pathKey(path));
    return at !== undefined && lastAt <= at;
  }

  isStarred(path: string): boolean {
    return this.starred.has(pathKey(path));
  }

  starredPaths(): string[] {
    return [...this.starred.values()];
  }

  private read(file: string): PrefsFile | undefined {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as PrefsFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('{0} ilegível ({1}); todas as pastas voltam à lista.', [file, errMsg(err)]));
      return undefined;
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const data = { version: 2, hidden: Object.fromEntries(this.hidden), starred: this.starredPaths() };
      writeFileSync(`${this.file}.tmp`, JSON.stringify(data, null, 2));
      renameSync(`${this.file}.tmp`, this.file);
    } catch (err) {
      log.warn(tr('Não consegui gravar {0}: {1}', [this.file, errMsg(err)]));
    }
  }
}
