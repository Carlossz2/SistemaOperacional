import { useState } from 'react';
import { Icon } from './Icon';
import { refreshNow } from '../lib/cloud/refresh';
import { isCloudActive } from '../lib/store';

/** Botão "Atualizar": puxa Meta + Mercado Pago na hora e recarrega os lançamentos. */
export function RefreshButton({ onResult }: { onResult?: (r: { ok: boolean; message: string; at: Date }) => void }) {
  const [busy, setBusy] = useState(false);
  if (!isCloudActive()) return null;
  const run = async () => {
    setBusy(true);
    try {
      const r = await refreshNow();
      onResult?.({ ...r, at: new Date() });
    } catch (err) {
      onResult?.({ ok: false, message: (err as Error).message, at: new Date() });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={run} disabled={busy} className={busy ? 'spin' : ''} title="Busca agora o gasto da Meta, o extrato do Mercado Pago e todos os lançamentos">
      <Icon name="refresh" size={15} /> {busy ? 'Atualizando…' : 'Atualizar'}
    </button>
  );
}
