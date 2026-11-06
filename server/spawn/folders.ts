// Pastas sugeridas no "Novo agente": os projetos em que você trabalhou por último, para escolher com um toque em vez de
// lembrar o caminho. Vêm do histórico de sessões (o `cwd` dos transcripts, de todas as contas e ferramentas) e das salas
// do escritório. Worktrees de agentes (<projeto>/.claude/worktrees/<nome>) contam como o projeto; pastas temporárias
// (e as scratch-workspaces do app do Claude) ficam de fora, assim como as que o usuário escondeu; as favoritas ficam sempre no topo (spawn/prefs.ts). Node puro: só junta e ordena (quem lê os transcripts é
// sources/history.ts).

export interface SpawnFolder {
  /** Caminho absoluto no computador do app do Claude. */
  path: string;
  /** Nome curto (última parte do caminho). */
  name: string;
  /** Atividade mais recente (epoch ms; 0 = só a sala, sem horário). */
  lastAt: number;
  /** Sessões recentes nesta pasta. */
  sessions: number;
  /** Favorita (estrela): sempre no topo, fora do limite. */
  starred?: boolean;
}

/** O que a lista consulta das preferências do usuário (spawn/prefs.ts). */
export interface FolderFilter {
  isHidden(path: string, lastAt: number): boolean;
  isStarred(path: string): boolean;
  starredPaths(): string[];
}

/** Pastas não favoritas mostradas (as favoritas vêm todas, por cima). */
export const FOLDERS_LIMIT = 30;

const TEMP = /^(\/private)?\/(tmp|var\/folders|var\/tmp)(\/|$)/;
/** Pastas descartáveis que o app desktop do Claude cria para sessões sem projeto. */
const SCRATCH = /\/Application Support\/Claude\/scratch-workspaces\//;
const WORKTREE = /^(.*?)\/\.(claude|codex)\/worktrees\/[^/]+(\/.*)?$/;

function absolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

/** A pasta do projeto para um caminho de sessão (worktree vira o projeto; temporária ou relativa = undefined). */
export function projectFolder(raw: string | undefined): string | undefined {
  const p = raw?.trim().replace(/[\\/]+$/, '');
  if (!p || !absolute(p) || TEMP.test(p) || SCRATCH.test(p)) return undefined;
  const wt = WORKTREE.exec(p);
  return wt ? wt[1] || undefined : p;
}

/** Junta sessões e salas em pastas únicas, da atividade mais recente para a mais antiga. */
export function recentFolders(
  sessions: ReadonlyArray<{ project?: string; lastAt: number }>,
  rooms: ReadonlyArray<{ path?: string; lastAt?: number }>,
  limit = FOLDERS_LIMIT,
  prefs?: FolderFilter,
): SpawnFolder[] {
  const byPath = new Map<string, SpawnFolder>();
  const add = (raw: string | undefined, lastAt: number, session: boolean) => {
    const path = projectFolder(raw);
    if (!path) return;
    const cur = byPath.get(path);
    if (cur) {
      cur.lastAt = Math.max(cur.lastAt, lastAt);
      if (session) cur.sessions++;
    } else byPath.set(path, { path, name: path.split(/[\\/]/).pop() || path, lastAt, sessions: session ? 1 : 0 });
  };
  for (const s of sessions) add(s.project, s.lastAt, true);
  for (const r of rooms) add(r.path, r.lastAt ?? 0, false);
  for (const p of prefs?.starredPaths() ?? []) add(p, 0, false);
  const all = [...byPath.values()];
  const starred = all.filter((f) => prefs?.isStarred(f.path)).map((f) => ({ ...f, starred: true }));
  const rest = all.filter((f) => !prefs?.isStarred(f.path) && !prefs?.isHidden(f.path, f.lastAt));
  return [
    ...starred.sort((a, b) => a.name.localeCompare(b.name)),
    ...rest.sort((a, b) => b.lastAt - a.lastAt || a.path.localeCompare(b.path)).slice(0, limit),
  ];
}
