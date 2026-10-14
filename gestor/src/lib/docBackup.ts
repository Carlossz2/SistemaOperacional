// Cópia de segurança dos documentos: nomes dos arquivos dentro do ZIP + índice em CSV (abre no Excel).

export interface BackupDoc {
  name: string;
  category: string;
  date: string;
  amount: number | null;
  notes: string | null;
  path: string;
  created_at: string;
  deleted_at?: string | null;
}

const clean = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150) || 'documento';

const extOf = (path: string) => path.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? '';

/** Caminho de cada documento dentro do ZIP: "Categoria/2026-10-14 - Nome.pdf" (lixeira em "Lixeira/…"), sem repetir. */
export function backupNames(docs: BackupDoc[]): string[] {
  const used = new Set<string>();
  return docs.map((d) => {
    const folder = (d.deleted_at ? 'Lixeira/' : '') + clean(d.category);
    const base = `${folder}/${d.date} - ${clean(d.name)}`;
    const ext = extOf(d.path);
    let name = base + ext;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} (${i})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

const cell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Índice de todos os documentos (separado por ";" e com BOM, para o Excel em português). */
export function backupIndex(docs: BackupDoc[], names: string[], missing: Set<string> = new Set()): string {
  const head = ['Data', 'Categoria', 'Nome', 'Valor', 'Observações', 'Arquivo no ZIP', 'Na lixeira', 'Enviado em', 'Caminho no Supabase'];
  const lines = docs.map((d, i) =>
    [
      d.date,
      d.category,
      d.name,
      d.amount === null ? '' : d.amount.toFixed(2).replace('.', ','),
      d.notes ?? '',
      missing.has(d.path) ? 'NÃO BAIXADO — tente de novo' : names[i],
      d.deleted_at ? 'sim' : 'não',
      d.created_at,
      d.path,
    ]
      .map(cell)
      .join(';'),
  );
  return '﻿' + [head.join(';'), ...lines].join('\r\n') + '\r\n';
}
