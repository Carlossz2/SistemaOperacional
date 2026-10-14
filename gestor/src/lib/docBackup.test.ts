import { describe, expect, it } from 'vitest';
import { backupIndex, backupNames, type BackupDoc } from './docBackup';

const doc = (o: Partial<BackupDoc>): BackupDoc => ({
  name: 'Nota',
  category: 'Nota fiscal',
  date: '2026-10-14',
  amount: null,
  notes: null,
  path: 'u/abc-nota.pdf',
  created_at: '2026-10-14T12:00:00Z',
  ...o,
});

describe('backupNames', () => {
  it('organiza por categoria, limpa caracteres proibidos e não repete nomes', () => {
    const names = backupNames([
      doc({}),
      doc({ path: 'u/def-nota.PDF' }),
      doc({ category: 'Imposto / guia', name: 'DAS: 09/2026', path: 'u/x-das.png' }),
      doc({ deleted_at: '2026-10-14T13:00:00Z', path: 'u/y' }),
    ]);
    expect(names).toEqual([
      'Nota fiscal/2026-10-14 - Nota.pdf',
      'Nota fiscal/2026-10-14 - Nota (2).PDF',
      'Imposto - guia/2026-10-14 - DAS- 09-2026.png',
      'Lixeira/Nota fiscal/2026-10-14 - Nota',
    ]);
  });
});

describe('backupIndex', () => {
  it('gera CSV com BOM, ; e aspas onde precisa, marcando o que não foi baixado', () => {
    const docs = [doc({ amount: 1234.5, notes: 'pago; via "pix"' }), doc({ path: 'u/z.pdf' })];
    const csv = backupIndex(docs, backupNames(docs), new Set(['u/z.pdf']));
    const lines = csv.slice(1).trim().split('\r\n');
    expect(csv.startsWith('﻿Data;Categoria')).toBe(true);
    expect(lines[1]).toBe('2026-10-14;Nota fiscal;Nota;1234,50;"pago; via ""pix""";Nota fiscal/2026-10-14 - Nota.pdf;não;2026-10-14T12:00:00Z;u/abc-nota.pdf');
    expect(lines[2]).toContain('NÃO BAIXADO');
  });
});
