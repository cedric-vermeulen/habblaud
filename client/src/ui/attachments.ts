// Anexos esperando o envio (Novo agente e caixa de mensagem): a lista com miniatura, nome, tamanho e o X para tirar;
// colar (Ctrl+V) ou soltar arquivos num campo; o envio de cada um em POST (JSON base64, um por arquivo), que devolve o
// id que o pedido ou a mensagem leva depois. O servidor grava os arquivos em ~/.habblaud/attachments e o texto ganha
// os caminhos (server/spawn/attachments.ts).
import { tr } from '../../../shared/i18n';
import { h, iconButton } from './dom';
import { ICONS } from './icons';

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => fail(new Error(tr('não deu para ler o arquivo')));
    r.readAsDataURL(file);
  });
}

/** JSON do Habblaud: o corpo, ou lança com o `error` dele (ou "erro N"). */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new Error(tr('o Habblaud não respondeu'));
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? tr('erro {0}', [res.status]));
  return body;
}

/** Arquivos colados (Ctrl+V) ou soltos em `target` vão para `add`; colar só texto segue como sempre. */
export function acceptFiles(target: HTMLElement, add: (files: File[]) => void): void {
  target.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    add(files);
  });
  target.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  target.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    add(files);
  });
}

interface PendingFile {
  file: File;
  url?: string;
  el: HTMLElement;
}

export class FileTray {
  readonly el: HTMLElement;
  private items: PendingFile[] = [];

  /** `onError`: o aviso de um arquivo recusado (grande demais, anexos demais). */
  constructor(private readonly onError: (text: string) => void) {
    this.el = h('ul', { class: 'ui-spawn__files', attrs: { 'aria-label': tr('Anexos') } });
  }

  get count(): number {
    return this.items.length;
  }

  add(list: File[]): void {
    for (const file of list) {
      if (this.items.length >= MAX_FILES) {
        this.onError(tr('No máximo {0} anexos por pedido.', [MAX_FILES]));
        break;
      }
      if (file.size > MAX_FILE_BYTES) {
        this.onError(tr('{0} passa de {1} MB.', [file.name, MAX_FILE_BYTES / 1024 / 1024]));
        continue;
      }
      if (!file.size) continue;
      const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      const item: PendingFile = { file, url, el: h('li', { class: 'ui-spawn__file' }) };
      const thumb = url ? h('img', { class: 'ui-spawn__thumb', attrs: { src: url, alt: '' } }) : h('span', { class: 'ui-spawn__thumb ui-spawn__thumb--doc', attrs: { 'aria-hidden': 'true' }, text: (file.name.split('.').pop() ?? '').slice(0, 4).toUpperCase() || tr('ARQ') });
      const remove = iconButton(ICONS.close, tr('Tirar {0}', [file.name]), () => this.remove(item), 'ui-icon-btn--sm ui-spawn__file-x');
      item.el.append(thumb, h('span', { class: 'ui-spawn__file-name', text: file.name, attrs: { title: file.name } }), h('span', { class: 'ui-spawn__file-size', text: formatBytes(file.size) }), remove);
      this.items.push(item);
      this.el.append(item.el);
    }
  }

  clear(): void {
    for (const f of [...this.items]) this.remove(f);
  }

  /** Manda os arquivos a `path`, um por vez, e devolve os ids na ordem; `progress` recebe a linha de situação. */
  async upload(path: string, progress: (text: string) => void): Promise<string[]> {
    const ids: string[] = [];
    for (const [i, f] of this.items.entries()) {
      progress(this.items.length > 1 ? tr('Enviando anexos ({0} de {1})…', [i + 1, this.items.length]) : tr('Enviando o anexo…'));
      const r = await api<{ id: string }>(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.file.name, type: f.file.type, data: await fileToBase64(f.file) }),
      });
      ids.push(r.id);
    }
    return ids;
  }

  private remove(item: PendingFile): void {
    if (item.url) URL.revokeObjectURL(item.url);
    item.el.remove();
    this.items = this.items.filter((f) => f !== item);
  }
}
