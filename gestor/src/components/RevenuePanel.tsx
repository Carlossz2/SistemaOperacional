import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ADAPTERS, type PlatformKey } from '../../../supabase/functions/_shared/adapters.ts';
import { BreakdownTable } from './BreakdownTable';
import { Icon } from './Icon';
import { MiniKpi } from './Kpi';
import { fmtDateTime, ReceivedSales, SALES_PLATFORMS, SalesIntegrationCard, useIntegrations, type Integration, type SecretStatus } from '../pages/Integrations';
import { supabase } from '../lib/cloud/sync';
import { previousPeriod } from '../lib/dates';
import { money, num, pct } from '../lib/format';
import { breakdown, computeTotals, saleGross } from '../lib/metrics';
import { usePeriod } from '../lib/period';
import { isCloudActive, useDb } from '../lib/store';

/** Topo da aba Receitas: plataformas conectadas (webhooks) + resultado do período + vendas recebidas ao vivo. */
export function RevenuePanel() {
  const { period } = usePeriod();
  const cloud = isCloudActive();
  return (
    <>
      {cloud ? <Platforms /> : <LocalNote />}
      <Performance />
      {cloud && <ReceivedSales period={period} />}
    </>
  );
}

function LocalNote() {
  return (
    <div className="callout mb">
      <h2>Vendas automáticas</h2>
      <p>
        Para receber as vendas da Hotmart, Cakto, Lastlink, GGCheckout, PerfectPay e outras sozinho, por webhook, conecte o Supabase em{' '}
        <Link to="/configuracoes">Configurações</Link>.
      </p>
    </div>
  );
}

type Tone = 'ok' | 'warn' | 'info';
function platformState(i: Integration, secret: SecretStatus | undefined, errors: number): { tone: Tone; label: string } {
  if (!i.enabled) return { tone: 'info', label: 'Desativada' };
  if (errors) return { tone: 'warn', label: `${errors} evento(s) com erro em 7 dias` };
  if (!i.last_event_at) return { tone: 'info', label: 'Aguardando a 1ª venda' };
  if (!secret?.has_secret) return { tone: 'warn', label: 'Recebendo · falta salvar o segredo' };
  return { tone: 'ok', label: 'Recebendo automaticamente' };
}

function Platforms() {
  const { list, secrets, reload, error, loaded } = useIntegrations();
  const [platform, setPlatform] = useState<PlatformKey>('hotmart');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, number>>({});
  const sales = list.filter((i) => i.platform !== 'meta');

  const loadErrors = useCallback(async () => {
    const { data } = await supabase()
      .from('webhook_events')
      .select('integration_id')
      .in('status', ['error', 'unauthorized'])
      .gte('received_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .limit(1000);
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as { integration_id: string | null }[]) if (r.integration_id) out[r.integration_id] = (out[r.integration_id] ?? 0) + 1;
    setErrors(out);
  }, []);
  useEffect(() => {
    void loadErrors();
    const sb = supabase();
    const ch = sb
      .channel(`rev-events-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'webhook_events' }, () => void loadErrors());
    ch.subscribe();
    const timer = setInterval(() => void loadErrors(), 60_000);
    return () => {
      clearInterval(timer);
      void sb.removeChannel(ch);
    };
  }, [loadErrors]);

  const add = async () => {
    setBusy(true);
    const name = platform === 'generic' ? 'Nova plataforma' : ADAPTERS[platform].label;
    const { data, error: e } = await supabase().from('integrations').insert({ platform, name, config: {} }).select('id').single();
    setBusy(false);
    if (e) return alert(e.message);
    setOpen((data as { id: string }).id);
    await reload();
  };

  if (!loaded && !error) return null;

  return (
    <div className="card mb">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box"><Icon name="plug" size={17} /></span>
          <h2>Plataformas de venda</h2>
        </div>
        <div className="head-actions">
          <select value={platform} onChange={(e) => setPlatform(e.target.value as PlatformKey)} aria-label="Plataforma">
            {SALES_PLATFORMS.map((p) => (
              <option key={p} value={p}>{ADAPTERS[p].label}</option>
            ))}
          </select>
          <button className="primary" disabled={busy} onClick={add}>
            <Icon name="plus" size={15} /> Conectar plataforma
          </button>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!sales.length ? (
        <p className="muted small" style={{ margin: 0 }}>
          Conecte cada plataforma uma vez: o sistema gera uma URL de webhook para colar no painel dela. A partir daí toda venda aprovada,
          reembolso e chargeback entra aqui sozinho, na hora, já com taxas, país e produto.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Plataforma</th>
                <th>Situação</th>
                <th>Último evento</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sales.map((i) => {
                const st = platformState(i, secrets[i.id], errors[i.id] ?? 0);
                return (
                  <tr key={i.id}>
                    <td>{i.platform === 'generic' ? i.name : ADAPTERS[i.platform as PlatformKey]?.label ?? i.name}</td>
                    <td><span className={`status ${st.tone}`}>{st.label}</span></td>
                    <td className="muted">{fmtDateTime(i.last_event_at)}</td>
                    <td className="num">
                      <button onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Fechar' : 'Configurar'}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {sales
        .filter((i) => i.id === open)
        .map((i) => (
          <div key={i.id} style={{ marginTop: 14 }}>
            <SalesIntegrationCard integ={i} secret={secrets[i.id]} onChange={reload} />
          </div>
        ))}
      {Object.values(errors).some(Boolean) && (
        <p className="muted small" style={{ margin: '10px 0 0' }}>
          Eventos com erro ficam guardados: veja o motivo em <Link to="/integracoes">Integrações → Eventos recebidos</Link> e clique em
          Reprocessar depois de corrigir.
        </p>
      )}
    </div>
  );
}

function Performance() {
  const db = useDb();
  const { period } = usePeriod();
  const [view, setView] = useState<'platform' | 'productId'>('platform');
  const cur = db.settings.baseCurrency;
  const m = (v: number) => money(v, cur);
  const { t, p, rows, autoShare } = useMemo(() => {
    const f = { from: period.from, to: period.to };
    const prev = previousPeriod(period);
    const inP = db.sales.filter((s) => s.date >= f.from && s.date <= f.to);
    const gross = inP.reduce((a, s) => a + saleGross(s), 0);
    const auto = inP.filter((s) => s.origin === 'auto').reduce((a, s) => a + saleGross(s), 0);
    return {
      t: computeTotals(db, f),
      p: computeTotals(db, { from: prev.from, to: prev.to }),
      rows: breakdown(db, f, view),
      autoShare: gross ? auto / gross : null,
    };
  }, [db, period, view]);
  const nameOf = (k: string) => (view === 'productId' ? db.products.find((x) => x.id === k)?.name ?? 'Sem produto' : k);

  return (
    <>
      <div className="grid mini-row">
        <MiniKpi label="Faturamento bruto" value={m(t.gross)} current={t.gross} previous={p.gross} />
        <MiniKpi label="Taxas" value={m(t.fees)} current={t.fees} previous={p.fees} inverse title="Plataforma, gateway, afiliados" />
        <MiniKpi label="Reembolsos + chargebacks" value={m(t.refunds)} current={t.refunds} previous={p.refunds} inverse />
        <MiniKpi label="Receita líquida" value={m(t.net)} current={t.net} previous={p.net} title="Bruto − taxas − reembolsos" />
        <MiniKpi label="Vendas" value={num(t.units)} current={t.units} previous={p.units} />
        <MiniKpi label="Ticket médio" value={t.aov === null ? '—' : m(t.aov)} current={t.aov} previous={p.aov} />
        <MiniKpi label="Taxa de reembolso" value={pct(t.refundRate)} current={t.refundRate} previous={p.refundRate} inverse />
        <MiniKpi
          label="Automático"
          value={pct(autoShare, 0)}
          current={null}
          previous={null}
          title="Parte do faturamento que chegou por webhook"
          extra={<span className="muted small">do faturamento via webhook</span>}
        />
      </div>

      <div className="card mb">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box"><Icon name="cash" size={17} /></span>
            <h2>Receita do período</h2>
          </div>
          <div className="tabs" role="tablist" style={{ margin: 0 }}>
            <button role="tab" aria-selected={view === 'platform'} className={view === 'platform' ? 'on' : ''} onClick={() => setView('platform')}>
              Por plataforma
            </button>
            <button role="tab" aria-selected={view === 'productId'} className={view === 'productId' ? 'on' : ''} onClick={() => setView('productId')}>
              Por produto
            </button>
          </div>
        </div>
        <BreakdownTable rows={rows} dim={view} currency={cur} nameOf={nameOf} targetCpa={view === 'productId' ? (k) => db.products.find((x) => x.id === k)?.targetCpa : undefined} />
      </div>
    </>
  );
}
