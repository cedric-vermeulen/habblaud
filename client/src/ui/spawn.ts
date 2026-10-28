// Novo agente (botão na barra do topo): começa uma sessão do Claude Code em segundo plano no Mac, na pasta escolhida e
// com o pedido (POST /api/spawn; server/spawn/spawn.ts). As pastas são os projetos recentes do computador
// (GET /api/spawn/folders: histórico de sessões + salas), para escolher com um toque; "Outra pasta" aceita um caminho
// digitado. O pedido pode levar anexos (POST /api/spawn/attachments, um por arquivo, antes do pedido) e ser ditado
// (ui/dictation.ts, Whisper local no Mac). Pasta que o Claude Code não conhece cai no app (Enter lá).
// Com "Abrir no terminal interativo", a sessão abre no terminal do Habblaud (POST /api/pty, com o pedido e os anexos).
import { tr } from '../../../shared/i18n';
import { isDemoId } from '../../../shared/timeline';
import type { OfficeSnapshot } from '../../../shared/types';
import { acceptFiles, api, FileTray } from './attachments';
import type { UiContext } from './context';
import { DictationButton, dictationAvailable, insertDictation } from './dictation';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';

export const SPAWN_PROMPT_MAX = 8_000;
const POLL_MS = 700;
/**
 * Quanto a página espera o pedido abrir: mais que o servidor leva para desistir (fila 30 s + `claude --bg` e `open`,
 * 50 s; server/spawn/spawn.ts), para nunca dizer "não confirmou" de algo que ainda vai abrir.
 */
const WAIT_MS = 90_000;
const LAST_FOLDER_KEY = 'habblaud.spawn.folder';
const INTERACTIVE_KEY = 'habblaud.spawn.interactive';

interface SpawnInfo {
  id: string;
  status: 'queued' | 'sent' | 'opened' | 'failed';
  error?: string;
  how?: 'cli' | 'app';
  note?: string;
}

export interface FolderOption {
  path: string;
  name: string;
  lastAt: number;
  sessions?: number;
}

/** Pastas das salas, da mais recente para a mais antiga (reserva quando o servidor não manda a lista). */
export function spawnFolders(snap: Pick<OfficeSnapshot, 'rooms' | 'agents'> | null | undefined): string[] {
  if (!snap) return [];
  const last = new Map<string, number>();
  for (const a of snap.agents) last.set(a.roomId, Math.max(last.get(a.roomId) ?? 0, a.lastEventAt ?? 0));
  const paths = [...snap.rooms]
    .filter((r) => !isDemoId(r.id) && /^(\/|[A-Za-z]:[\\/])/.test(r.path ?? ''))
    .sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0))
    .map((r) => r.path);
  return [...new Set(paths)];
}

/** Caminho curto para a lista: a pasta pessoal vira "~". */
export function shortPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/i, '~');
}

/** "agora", "5 min", "3 h", "2 d" (vazio sem horário). */
export function ago(at: number, now = Date.now()): string {
  if (!at) return '';
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return tr('agora');
  if (min < 60) return `${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

function readPref(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sem armazenamento: só não lembra
  }
}

export class SpawnPanel {
  readonly el: HTMLElement;
  private readonly folderList: HTMLElement;
  private readonly otherBtn: HTMLButtonElement;
  private readonly folder: HTMLInputElement;
  private readonly prompt: HTMLTextAreaElement;
  private readonly fileInput: HTMLInputElement;
  private readonly files: FileTray;
  private readonly dictate: DictationButton;
  private readonly interactive: HTMLInputElement;
  private readonly interactiveRow: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly submitBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  private anchor?: HTMLElement;
  private busy = false;
  private folders: FolderOption[] = [];
  private selected = '';
  private typing = false;

  constructor(private readonly ctx: UiContext) {
    this.folderList = h('div', { class: 'ui-spawn__folders', role: 'radiogroup', attrs: { 'aria-label': tr('Projetos recentes') } });
    this.otherBtn = h('button', { class: 'ui-spawn__other', type: 'button', on: { click: () => this.showOther(true) } }, tr('+ Outra pasta'));
    this.folder = h('input', {
      class: 'ui-rename__input ui-spawn__path',
      type: 'text',
      hidden: true,
      attrs: { id: 'ui-spawn-folder', placeholder: '/Users/voce/projeto', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none', 'aria-label': tr('Caminho da pasta') },
    });
    this.prompt = h('textarea', {
      class: 'ui-rename__input ui-spawn__prompt',
      attrs: { id: 'ui-spawn-prompt', rows: 5, maxlength: SPAWN_PROMPT_MAX, placeholder: tr('O que o agente deve fazer (opcional)') },
    });
    this.fileInput = h('input', { type: 'file', hidden: true, attrs: { multiple: true, 'aria-hidden': 'true', tabindex: '-1' } });
    this.files = new FileTray((text) => this.say(text, true));
    acceptFiles(this.prompt, (files) => this.files.add(files));
    this.fileInput.addEventListener('change', () => {
      this.files.add([...(this.fileInput.files ?? [])]);
      this.fileInput.value = '';
    });
    const attachBtn = h('button', { class: 'ui-btn ui-spawn__attach', type: 'button', attrs: { title: tr('Anexar imagens ou arquivos ao pedido') }, on: { click: () => this.fileInput.click() } });
    const clip = h('span', { attrs: { 'aria-hidden': 'true' } });
    clip.innerHTML = ICONS.attach;
    attachBtn.append(clip, h('span', { text: tr('Anexar') }));
    this.dictate = new DictationButton(
      (t) => {
        const { value, caret } = insertDictation(this.prompt.value, this.prompt.selectionStart ?? this.prompt.value.length, this.prompt.selectionEnd ?? this.prompt.value.length, t.text);
        this.prompt.value = value.slice(0, SPAWN_PROMPT_MAX);
        this.prompt.setSelectionRange(caret, caret);
      },
      (text, error) => this.say(text, error),
    );
    setHidden(this.dictate.el, true);
    this.interactive = h('input', { type: 'checkbox', class: 'ui-perm__check' });
    this.interactive.checked = readPref(INTERACTIVE_KEY) === '1';
    this.interactive.addEventListener('change', () => {
      writePref(INTERACTIVE_KEY, this.interactive.checked ? '1' : '0');
      this.syncMode();
    });
    this.interactiveRow = h('label', { class: 'ui-perm__check-row', hidden: true }, this.interactive, h('span', { text: tr('Abrir no terminal interativo') }));
    this.hint = h('p', { class: 'ui-rename__hint' });
    this.submitBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow ui-spawn__go', type: 'button', on: { click: () => void this.submit() } }, tr('Começar'));
    this.status = h('p', { class: 'ui-rename__hint ui-spawn__status', attrs: { role: 'status', 'aria-live': 'polite' } });
    for (const field of [this.folder, this.prompt] as HTMLElement[]) {
      field.addEventListener('keydown', (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void this.submit();
        }
      });
      field.addEventListener('keyup', (e) => e.stopPropagation());
    }
    this.folder.addEventListener('input', () => {
      this.selected = this.folder.value.trim();
      this.renderFolders();
    });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm');
    this.el = h(
      'div',
      { class: 'ui-popover ui-spawn', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Novo agente'), id: 'ui-spawn', popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Novo agente') }), close),
      h(
        'div',
        { class: 'ui-set-group ui-spawn__body' },
        h('p', { class: 'ui-spawn__label', attrs: { id: 'ui-spawn-folders-label' }, text: tr('Projeto') }),
        this.folderList,
        this.otherBtn,
        this.folder,
        h('label', { class: 'ui-spawn__label', attrs: { for: 'ui-spawn-prompt' }, text: tr('Pedido') }),
        this.prompt,
        h('div', { class: 'ui-spawn__tools' }, this.dictate.el, attachBtn, this.fileInput),
        this.files.el,
        this.interactiveRow,
        this.hint,
        this.submitBtn,
        this.status,
      ),
    );
    this.el.addEventListener('toggle', () => {
      this.anchor?.setAttribute('aria-expanded', String(this.isOpen));
      if (!this.isOpen) this.dictate.cancel();
    });
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(anchor: HTMLElement): void {
    this.anchor = anchor;
    if (this.isOpen) return this.hide();
    // Primeiro com o que o escritório já sabe; a lista do servidor (histórico) chega logo depois.
    if (!this.folders.length) this.setFolders(spawnFolders(this.ctx.store.snapshot).map((path) => ({ path, name: path.split(/[\\/]/).pop() || path, lastAt: 0 })));
    void this.loadFolders();
    void this.checkDictation();
    setHidden(this.interactiveRow, !this.ctx.terminals?.interactiveEnabled);
    this.syncMode();
    if (!this.busy) setText(this.status, '');
    const r = anchor.getBoundingClientRect();
    this.el.style.top = `${Math.round(r.bottom + 8)}px`;
    this.el.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 4))}px`;
    if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
    // No celular, focar o campo abriria o teclado por cima da lista de projetos.
    if (!matchMedia('(pointer: coarse)').matches) this.prompt.focus();
  }

  hide(): void {
    this.dictate.cancel();
    if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
    this.el.classList.remove('is-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
  }

  private async loadFolders(): Promise<void> {
    try {
      const r = await api<{ folders: FolderOption[] }>('/api/spawn/folders');
      if (Array.isArray(r.folders) && r.folders.length) this.setFolders(r.folders);
    } catch {
      // fica a lista das salas
    }
  }

  /** Abre no terminal interativo: marcado e com o recurso ligado. */
  private get inPty(): boolean {
    return this.interactive.checked && !!this.ctx.terminals?.interactiveEnabled;
  }

  private syncMode(): void {
    setText(
      this.hint,
      this.inPty
        ? tr('Começa a sessão em segundo plano e já abre no terminal interativo do Habblaud, com o pedido: dá para digitar, responder e usar os comandos. Reiniciar o Habblaud não encerra o agente (o npm run agents:stop encerra). Anexos vão para ~/.habblaud/attachments e o pedido leva os caminhos.')
        : tr('Começa na hora uma sessão do Claude Code em segundo plano no computador, na pasta escolhida; as permissões chegam aqui. Pasta que o Claude Code ainda não conhece abre no app do Claude e espera o Enter lá. Anexos vão para ~/.habblaud/attachments e o pedido leva os caminhos.'),
    );
  }

  private async checkDictation(): Promise<void> {
    setHidden(this.dictate.el, !(await dictationAvailable()));
  }

  private setFolders(list: FolderOption[]): void {
    this.folders = list;
    if (!this.selected) {
      const pref = readPref(LAST_FOLDER_KEY);
      this.selected = list.some((f) => f.path === pref) ? pref : (list[0]?.path ?? '');
    }
    this.renderFolders();
  }

  private renderFolders(): void {
    const now = Date.now();
    const known = this.folders.some((f) => f.path === this.selected);
    this.folderList.replaceChildren(
      ...this.folders.map((f) => {
        const on = f.path === this.selected && !this.typing;
        const when = ago(f.lastAt, now);
        const card = h(
          'button',
          {
            class: `ui-spawn__folder${on ? ' is-on' : ''}`,
            type: 'button',
            role: 'radio',
            attrs: { 'aria-checked': String(on), title: f.path },
            on: { click: () => this.pick(f.path) },
          },
          h('span', { class: 'ui-spawn__folder-name', text: f.name }),
          h('span', { class: 'ui-spawn__folder-path', text: shortPath(f.path) }),
          when ? h('span', { class: 'ui-spawn__folder-when', text: when }) : null,
        );
        const remove = iconButton(ICONS.close, tr('Tirar {0} da lista', [f.name]), () => void this.hideFolder(f.path), 'ui-icon-btn--sm ui-spawn__folder-hide');
        return h('div', { class: 'ui-spawn__folder-row' }, card, remove);
      }),
    );
    if (!this.folders.length) this.showOther(true);
    else if (!known && this.selected && !this.typing) this.showOther(true, this.selected);
  }

  private pick(path: string): void {
    this.selected = path;
    this.typing = false;
    setHidden(this.folder, true);
    this.otherBtn.classList.remove('is-on');
    this.renderFolders();
  }

  /** Tira a pasta da lista (volta sozinha quando houver sessão nova nela). */
  private async hideFolder(path: string): Promise<void> {
    try {
      await api('/api/spawn/folders/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
    } catch (err) {
      return this.say(tr('Não deu para tirar da lista: {0}', [(err as Error).message]), true);
    }
    this.folders = this.folders.filter((f) => f.path !== path);
    if (this.selected === path && !this.typing) this.selected = this.folders[0]?.path ?? '';
    this.renderFolders();
  }

  private showOther(on: boolean, value?: string): void {
    this.typing = on;
    setHidden(this.folder, !on);
    this.otherBtn.classList.toggle('is-on', on);
    if (on) {
      if (value !== undefined) this.folder.value = value;
      this.selected = this.folder.value.trim();
      this.folderList.querySelectorAll('.ui-spawn__folder').forEach((b) => {
        b.classList.remove('is-on');
        b.setAttribute('aria-checked', 'false');
      });
      if (value === undefined) this.folder.focus();
    }
  }

  private say(text: string, error = false): void {
    setText(this.status, text);
    this.status.classList.toggle('is-error', error);
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (this.dictate.busy) return this.say(tr('Espere o ditado terminar.'), true);
    const folder = (this.typing ? this.folder.value : this.selected).trim();
    if (!folder) return this.say(tr('Escolha o projeto.'), true);
    this.busy = true;
    this.submitBtn.disabled = true;
    try {
      const ids = await this.files.upload('/api/spawn/attachments', (text) => this.say(text));
      const terminals = this.ctx.terminals;
      if (this.inPty && terminals) {
        this.say(tr('Abrindo o terminal…'));
        await terminals.newSession(folder, undefined, { prompt: this.prompt.value, background: true, ...(ids.length ? { attachments: ids } : {}) });
        this.prompt.value = '';
        this.files.clear();
        writePref(LAST_FOLDER_KEY, folder);
        this.say('');
        this.hide();
        return;
      }
      this.say(tr('Começando no computador…'));
      let info = await api<SpawnInfo>('/api/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, prompt: this.prompt.value, ...(ids.length ? { attachments: ids } : {}) }),
      });
      const end = Date.now() + WAIT_MS;
      while ((info.status === 'queued' || info.status === 'sent') && Date.now() < end) {
        await new Promise((ok) => setTimeout(ok, POLL_MS));
        info = await api<SpawnInfo>(`/api/spawn/${encodeURIComponent(info.id)}`);
      }
      if (info.status === 'opened') {
        const running = info.how === 'cli';
        this.say(
          running
            ? tr('Rodando: a sessão já começou no computador e aparece no escritório em instantes.')
            : info.note
              ? tr('Abri no app do Claude: aperte Enter lá para começar. Não rodou sozinho: {0}.', [info.note])
              : tr('Abri no app do Claude: aperte Enter lá para começar.'),
          !running && !!info.note,
        );
        this.prompt.value = '';
        this.files.clear();
        writePref(LAST_FOLDER_KEY, folder);
        this.ctx.announce(running ? tr('Agente novo rodando.') : tr('Agente novo aberto no app do Claude.'));
      } else this.say(info.error ? tr('Não abriu: {0}', [info.error]) : tr('O computador não confirmou a abertura.'), true);
    } catch (err) {
      this.say(tr('Não abriu: {0}', [(err as Error).message]), true);
    } finally {
      this.busy = false;
      this.submitBtn.disabled = false;
    }
  }
}
