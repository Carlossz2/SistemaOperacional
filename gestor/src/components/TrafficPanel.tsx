import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BreakdownTable } from './BreakdownTable';
import { Icon } from './Icon';
import { MiniKpi } from './Kpi';
import { fmtDateTime, MetaCard, useIntegrations } from '../pages/Integrations';
import { reloadAll, supabase } from '../lib/cloud/sync';
import { addDays, previousPeriod, today } from '../lib/dates';
import { money, num, pct, ratio } from '../lib/format';
import { breakdown, campaignBreakdown, computeTotals } from '../lib/metrics';
import { usePeriod } from '../lib/period';
import { isCloudActive, useDb } from '../lib/store';

/** Topo da aba Tráfego pago: conexão com a Meta + performance do período (gasto × vendas × lucro × ROI). */
export function TrafficPanel() {
  return (
    <>
      {isCloudActive() ? <MetaConnection /> : <LocalNote />}
      <Performance />
    </>
  );
}

function LocalNote() {
  return (
    <div className="callout mb">
      <h2>Gastos da Meta automáticos</h2>
      <p>
        Para puxar os gastos da Meta Ads sozinho, de hora em hora, conecte o Supabase em <Link to="/configuracoes">Configurações</Link>.
      </p>
    </div>
  );
}

function MetaConnection() {
  const { list, secrets, reload: refresh, error, loaded } = useIntegrations();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const meta = list.find((i) => i.platform === 'meta');

  const connect = async () => {
    setBusy(true);
    const { error: e } = await supabase().from('integrations').insert({ platform: 'meta', name: 'Meta Ads', config: { accountIds: [], rules: [], byCountry: true } });
    setBusy(false);
    if (e) return alert(e.message);
    setOpen(true);
    await refresh();
  };

  const syncNow = async () => {
    if (!meta) return;
    setBusy(true);
    setMsg('Sincronizando com a Meta…');
    const { data, error: e } = await supabase().functions.invoke('meta-sync', {
      body: { integrationId: meta.id, since: addDays(today(), -6), until: today() },
    });
    setBusy(false);
    setMsg(e ? `Erro: ${e.message}` : (data?.results ?? []).map((r: { ok: boolean; message: string }) => `${r.ok ? '✓' : '✗'} ${r.message}`).join(' · '));
    await refresh();
    void reloadAll().catch(() => undefined);
  };

  if (!loaded && !error) return null;

  const accounts = ((meta?.config.accountIds as string[] | undefined) ?? []).length;
  const hasToken = Boolean(meta && secrets[meta.id]?.has_access_token);
  const missing = meta && (!hasToken ? 'Falta salvar o token de acesso.' : !accounts ? 'Falta informar a conta de anúncio (act_…).' : '');
  const lastError = meta?.last_sync_status?.startsWith('erro') ? meta.last_sync_status.replace(/^erro:\s*/, '') : '';
  const state = !meta
    ? null
    : missing
      ? { tone: 'warn', label: 'Configuração incompleta' }
      : lastError
        ? { tone: 'warn', label: 'Erro na última sincronização' }
        : meta.enabled
          ? { tone: 'ok', label: 'Automático · de hora em hora' }
          : { tone: 'info', label: 'Sincronização automática pausada' };
  const showConfig = Boolean(meta) && (open || Boolean(missing));

  return (
    <div className="card mb">
      <div className="card-head">
        <div className="card-title">
          <span className="icon-box"><Icon name="ads" size={17} /></span>
          <h2>Meta Ads</h2>
          {state && <span className={`status ${state.tone}`}>{state.label}</span>}
        </div>
        <div className="head-actions">
          {!meta ? (
            <button className="primary" disabled={busy} onClick={connect}>
              <Icon name="plus" size={15} /> Conectar Meta Ads
            </button>
          ) : (
            <>
              <button disabled={busy || Boolean(missing)} onClick={syncNow}>
                <Icon name="refresh" size={14} /> Sincronizar agora
              </button>
              {!missing && <button onClick={() => setOpen(!open)}>{open ? 'Fechar configuração' : 'Configurar'}</button>}
            </>
          )}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!meta ? (
        <p className="muted small" style={{ margin: 0 }}>
          Conecte uma vez e o gasto de cada campanha entra aqui sozinho, de hora em hora, já cruzado com as vendas das plataformas para mostrar
          lucro, ROAS, CPA e ROI por produto.
        </p>
      ) : (
        <p className="muted small" style={{ margin: showConfig ? '0 0 14px' : 0 }}>
          {missing ||
            msg ||
            (lastError
              ? `Última tentativa ${fmtDateTime(meta.last_sync_at)}: ${lastError}`
              : meta.last_sync_at
                ? `${accounts} conta(s) · última sincronização ${fmtDateTime(meta.last_sync_at)} · ${(meta.last_sync_status ?? '').replace(/^ok:\s*/, '')}`
                : 'Pronto. Clique em "Sincronizar agora" e escolha até 12 meses para trazer o histórico.')}
        </p>
      )}
      {showConfig && meta && <MetaCard integ={meta} secret={secrets[meta.id]} onChange={refresh} />}
    </div>
  );
}

function Performance() {
  const db = useDb();
  const { period } = usePeriod();
  const [view, setView] = useState<'produto' | 'campanha'>('produto');
  const cur = db.settings.baseCurrency;
  const m = (v: number) => money(v, cur);
  const { t, p, products, campaigns } = useMemo(() => {
    const f = { from: period.from, to: period.to };
    const prev = previousPeriod(period);
    return {
      t: computeTotals(db, f),
      p: computeTotals(db, { from: prev.from, to: prev.to }),
      products: breakdown(db, f, 'productId'),
      campaigns: campaignBreakdown(db, f),
    };
  }, [db, period]);
  const unassigned = campaigns.filter((c) => !c.productId).reduce((a, c) => a + c.spend, 0);
  const productName = (id: string) => db.products.find((x) => x.id === id)?.name ?? (id === '—' || !id ? 'Sem produto' : '—');

  return (
    <>
      <div className="grid mini-row">
        <MiniKpi label="Investido em ads" value={m(t.ads)} current={t.ads} previous={p.ads} inverse />
        <MiniKpi label="Faturamento bruto" value={m(t.gross)} current={t.gross} previous={p.gross} />
        <MiniKpi label="Receita líquida" value={m(t.net)} current={t.net} previous={p.net} title="Bruto − taxas − reembolsos" />
        <MiniKpi label="Vendas" value={num(t.units)} current={t.units} previous={p.units} />
        <MiniKpi label="CPA" value={t.cpa === null ? '—' : m(t.cpa)} current={t.cpa} previous={p.cpa} inverse title="Ads ÷ nº de vendas" />
        <MiniKpi label="ROAS" value={ratio(t.roas)} current={t.roas} previous={p.roas} title="Faturamento bruto ÷ ads" />
        <MiniKpi
          label="Lucro"
          value={m(t.profit)}
          negative={t.profit < 0}
          current={t.profit}
          previous={p.profit}
          title="Receita líquida − ads − despesas − impostos"
        />
        <MiniKpi label="ROI" value={pct(t.roi)} negative={t.roi !== null && t.roi < 0} current={t.roi} previous={p.roi} title="Lucro ÷ (ads + despesas)" />
      </div>

      <div className="card mb">
        <div className="card-head">
          <div className="card-title">
            <span className="icon-box"><Icon name="trend" size={17} /></span>
            <h2>Performance do período</h2>
          </div>
          <div className="tabs" role="tablist" style={{ margin: 0 }}>
            <button role="tab" aria-selected={view === 'produto'} className={view === 'produto' ? 'on' : ''} onClick={() => setView('produto')}>
              Por produto
            </button>
            <button role="tab" aria-selected={view === 'campanha'} className={view === 'campanha' ? 'on' : ''} onClick={() => setView('campanha')}>
              Por campanha
            </button>
          </div>
        </div>
        {unassigned > 0 && (
          <p className="small" style={{ margin: '0 0 12px' }}>
            <span className="status warn">{m(unassigned)} de gasto sem produto</span>{' '}
            <span className="muted">
              Esse gasto entra no total, mas não no lucro de nenhum produto. Crie regras "campanha → produto" (ou um produto padrão) na conexão
              Meta acima e clique em Sincronizar agora.
            </span>
          </p>
        )}
        {view === 'produto' ? (
          <>
            <BreakdownTable rows={products} dim="productId" currency={cur} nameOf={productName} targetCpa={(k) => db.products.find((x) => x.id === k)?.targetCpa} />
            <p className="muted small" style={{ margin: '10px 0 0' }}>
              Gasto da Meta × vendas reais das plataformas, por produto. O gasto vai para o produto pelas regras "campanha → produto" da conexão
              Meta.
            </p>
          </>
        ) : (
          <CampaignTable rows={campaigns} productName={productName} money={m} />
        )}
      </div>
    </>
  );
}

function CampaignTable({ rows, productName, money: m }: { rows: ReturnType<typeof campaignBreakdown>; productName: (id: string) => string; money: (v: number) => string }) {
  if (!rows.length) return <div className="empty">Sem gasto no período.</div>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campanha</th>
              <th>Produto</th>
              <th className="num">Gasto</th>
              <th className="num">Impressões</th>
              <th className="num">Cliques</th>
              <th className="num">CTR</th>
              <th className="num">CPC</th>
              <th className="num">CPM</th>
              <th className="num">Compras (pixel)</th>
              <th className="num">CPA (pixel)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.source}|${r.campaign}|${r.productId}`}>
                <td>
                  {r.campaign}
                  {r.source !== 'Meta Ads' && <span className="muted small"> · {r.source}</span>}
                </td>
                <td>{productName(r.productId)}</td>
                <td className="num">{m(r.spend)}</td>
                <td className="num">{r.impressions ? num(r.impressions) : '—'}</td>
                <td className="num">{r.clicks ? num(r.clicks) : '—'}</td>
                <td className="num">{pct(r.ctr, 2)}</td>
                <td className="num">{r.cpc === null ? '—' : m(r.cpc)}</td>
                <td className="num">{r.cpm === null ? '—' : m(r.cpm)}</td>
                <td className="num">{r.purchases ? num(r.purchases) : '—'}</td>
                <td className="num">{r.cpa === null ? '—' : m(r.cpa)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        Compras e CPA "pixel" são os números que a Meta informa. O lucro e o ROI reais ficam em "Por produto", calculados com as vendas que as
        plataformas confirmaram.
      </p>
    </>
  );
}
