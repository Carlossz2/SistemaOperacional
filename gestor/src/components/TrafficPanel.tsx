import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BreakdownTable } from './BreakdownTable';
import { Icon } from './Icon';
import { MiniKpi } from './Kpi';
import { fmtDateTime, MetaCard, useIntegrations } from '../pages/Integrations';
import { reloadAll, supabase } from '../lib/cloud/sync';
import { addDays, previousPeriod, today } from '../lib/dates';
import { money, num, pct, ratio } from '../lib/format';
import { breakdown, campaignBreakdown, campaignNames, computeTotals, type CampaignRow } from '../lib/metrics';
import { usePeriod } from '../lib/period';
import { isCloudActive, useDb } from '../lib/store';

export interface TrafficFilter {
  productId: string;
  campaign: string;
}

interface PanelProps {
  filter: TrafficFilter;
  onFilter: (f: TrafficFilter) => void;
  onAddSale: () => void;
}

/** Topo da aba Tráfego pago: conexão com a Meta + performance do período (gasto × vendas × lucro × ROI). */
export function TrafficPanel(props: PanelProps) {
  return (
    <>
      {isCloudActive() ? <MetaConnection /> : <LocalNote />}
      <Performance {...props} />
    </>
  );
}

function Filters({ filter, onFilter, onAddSale }: PanelProps) {
  const db = useDb();
  const campaigns = useMemo(() => campaignNames(db, filter.productId || undefined), [db, filter.productId]);
  const products = [...db.products].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'));
  return (
    <div className="toolbar">
      <select
        aria-label="Filtrar produto"
        value={filter.productId}
        onChange={(e) => {
          const productId = e.target.value;
          const keep = !filter.campaign || campaignNames(db, productId || undefined).includes(filter.campaign);
          onFilter({ productId, campaign: keep ? filter.campaign : '' });
        }}
      >
        <option value="">Todos os produtos</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>{p.active ? p.name : `${p.name} (pausado)`}</option>
        ))}
      </select>
      <select aria-label="Filtrar campanha" value={filter.campaign} onChange={(e) => onFilter({ ...filter, campaign: e.target.value })}>
        <option value="">Todas as campanhas</option>
        {filter.campaign && !campaigns.includes(filter.campaign) && <option value={filter.campaign}>{filter.campaign}</option>}
        {campaigns.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      {(filter.productId || filter.campaign) && (
        <button className="ghost" onClick={() => onFilter({ productId: '', campaign: '' })}>
          <Icon name="close" size={14} /> Limpar filtros
        </button>
      )}
      <span style={{ flex: 1 }} />
      <button onClick={onAddSale}>
        <Icon name="plus" size={15} /> Venda manual
      </button>
    </div>
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

function Performance(props: PanelProps) {
  const { filter, onFilter } = props;
  const db = useDb();
  const { period } = usePeriod();
  const [view, setView] = useState<'produto' | 'campanha'>('produto');
  const cur = db.settings.baseCurrency;
  const m = (v: number) => money(v, cur);
  const { t, p, products, campaigns } = useMemo(() => {
    const dims = { productId: filter.productId || undefined, campaign: filter.campaign || undefined };
    const f = { from: period.from, to: period.to, ...dims };
    const prev = previousPeriod(period);
    return {
      t: computeTotals(db, f),
      p: computeTotals(db, { from: prev.from, to: prev.to, ...dims }),
      products: breakdown(db, f, 'productId'),
      campaigns: campaignBreakdown(db, f),
    };
  }, [db, period, filter.productId, filter.campaign]);
  const unassigned = campaigns.filter((c) => !c.productId).reduce((a, c) => a + c.ads, 0);
  const productName = (id: string) => db.products.find((x) => x.id === id)?.name ?? (id === '—' || !id ? 'Sem produto' : '—');

  return (
    <>
      <Filters {...props} />
      {filter.campaign && (
        <p className="muted small" style={{ margin: '-4px 0 12px' }}>
          Campanha "{filter.campaign}": entram os gastos dela e as vendas lançadas com o nome dela. Vendas por webhook não trazem a campanha, e
          despesas fixas não entram (o lucro aqui é a margem da campanha).
        </p>
      )}
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
          <CampaignTable rows={campaigns} productName={productName} money={m} onPick={(campaign) => onFilter({ ...filter, campaign })} />
        )}
      </div>
    </>
  );
}

function CampaignTable(p: { rows: CampaignRow[]; productName: (id: string) => string; money: (v: number) => string; onPick: (campaign: string) => void }) {
  const { rows, productName, money: m } = p;
  if (!rows.length) return <div className="empty">Sem gasto nem vendas com campanha no período.</div>;
  const opt = (v: number | null, f: (x: number) => string) => (v === null ? '—' : f(v));
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Campanha</th>
              <th>Produto</th>
              <th className="num">Gasto</th>
              <th className="num">Vendas</th>
              <th className="num">Faturamento</th>
              <th className="num">Lucro</th>
              <th className="num">ROI</th>
              <th className="num">ROAS</th>
              <th className="num">CPA</th>
              <th className="num">Cliques</th>
              <th className="num">CTR</th>
              <th className="num">CPC</th>
              <th className="num">Compras (pixel)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.campaign}|${r.productId}`}>
                <td>
                  {r.campaign === '(sem campanha)' ? (
                    r.campaign
                  ) : (
                    <button className="link" title="Filtrar por esta campanha" onClick={() => p.onPick(r.campaign)}>
                      {r.campaign}
                    </button>
                  )}
                  {r.source && r.source !== 'Meta Ads' && <span className="muted small"> · {r.source}</span>}
                </td>
                <td>{productName(r.productId)}</td>
                <td className="num">{m(r.ads)}</td>
                <td className="num">{r.units ? num(r.units) : '—'}</td>
                <td className="num">{r.gross ? m(r.gross) : '—'}</td>
                <td className={`num ${r.profit < 0 ? 'neg' : 'pos'}`}>{r.units ? m(r.profit) : '—'}</td>
                <td className="num">{r.units ? pct(r.roi) : '—'}</td>
                <td className="num">{r.units ? ratio(r.roas) : '—'}</td>
                <td className="num">{opt(r.cpa, m)}</td>
                <td className="num">{r.clicks ? num(r.clicks) : '—'}</td>
                <td className="num">{pct(r.ctr, 2)}</td>
                <td className="num">{opt(r.cpc, m)}</td>
                <td className="num" title={r.pixelCpa === null ? undefined : `CPA do pixel: ${m(r.pixelCpa)}`}>{r.purchases ? num(r.purchases) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ margin: '10px 0 0' }}>
        Vendas, lucro e ROI da campanha vêm das vendas lançadas com o nome dela (botão "Venda manual"). Compras (pixel) é o que a Meta
        informa. Clique numa campanha para filtrar a aba inteira por ela.
      </p>
    </>
  );
}
