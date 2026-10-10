// Backup, exportação CSV e cotações online.

export function download(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV com ";" e BOM para abrir certo no Excel em português. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers.join(';'), ...rows.map((r) => headers.map((h) => esc(r[h])).join(';'))].join('\n');
}

/**
 * Busca cotações atuais (API pública e gratuita, sem chave).
 * Retorna quantas unidades da moeda base valem 1 unidade de cada moeda.
 */
export async function fetchRates(base: string, currencies: string[]): Promise<Record<string, number>> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { result: string; rates: Record<string, number> };
  if (data.result !== 'success') throw new Error('Resposta inválida da API de câmbio');
  const out: Record<string, number> = { [base]: 1 };
  for (const c of currencies) {
    const perBase = data.rates[c];
    if (perBase) out[c] = Number((1 / perBase).toFixed(6));
  }
  return out;
}
