import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLaunched, recordLaunched } from './launched';

describe('agentes abertos pelo Habblaud (launched.json)', () => {
  it('anota cada agente uma vez, na ordem, e cria a pasta', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'hb-launched-')), 'sub', 'launched.json');
    recordLaunched({ id: 'a1', folder: '/p/a' }, file, 1);
    recordLaunched({ id: 'b2', folder: '/p/b' }, file, 2);
    recordLaunched({ id: 'a1', folder: '/p/a' }, file, 3);
    expect(readLaunched(file)).toEqual([
      { id: 'b2', folder: '/p/b', at: 2 },
      { id: 'a1', folder: '/p/a', at: 3 },
    ]);
  });

  it('arquivo ausente, estragado ou com itens inválidos: lista vazia ou só os válidos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hb-launched-'));
    expect(readLaunched(join(dir, 'nada.json'))).toEqual([]);
    writeFileSync(join(dir, 'ruim.json'), '{');
    expect(readLaunched(join(dir, 'ruim.json'))).toEqual([]);
    writeFileSync(join(dir, 'misto.json'), JSON.stringify({ jobs: [{ id: 'ok', folder: '/x', at: 1 }, { id: 2 }, null] }));
    expect(readLaunched(join(dir, 'misto.json'))).toEqual([{ id: 'ok', folder: '/x', at: 1 }]);
  });
});
