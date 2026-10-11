import type { BreakdownRow } from '../lib/metrics';
import { money, num, pct, ratio } from '../lib/format';

export type Dim = 'productId' | 'country' | 'platform' | 'source';

export const DIM_LABEL: Record<Dim, string> = {
  productId: 'Produto',
  country: 'País',
  platform: 'Plataforma',
  source: 'Fonte de tráfego',
};

interface Props {
  rows: BreakdownRow[];
  dim: Dim;
  currency: string;
  nameOf?: (key: string) => string;
  limit?: number;
  /** CPA alvo por chave (produto) para destacar quando estourar */
  targetCpa?: (key: string) => number | undefined;
  /** Esconde colunas secundárias (vendas, líquido, reembolso, margem) para cards estreitos */
  compact?: boolean;
}

/** Tabela de performance: colunas mudam conforme a dimensão tem receita, ads ou ambos. */
export function BreakdownTable({ rows, dim, currency, nameOf = (k) => k, limit, targetCpa, compact }: Props) {
  const shown = limit ? rows.slice(0, limit) : rows;
  const hasRevenue = dim !== 'source';
  const hasAds = dim !== 'platform';
  const full = !compact;
  const maxAds = Math.max(1, ...rows.map((r) => r.ads));
  const m = (v: number) => money(v, currency);
  if (!rows.length) return <div className="empty">Sem dados no período.</div>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{DIM_LABEL[dim]}</th>
            {hasRevenue && full && <th className="num">Vendas</th>}
            {hasRevenue && <th className="num">Bruto</th>}
            {hasRevenue && full && <th className="num">Líquido</th>}
            {hasAds && <th className={hasRevenue ? 'num' : ''}>Ads</th>}
            {hasRevenue && hasAds && <th className="num">ROAS</th>}
            {hasRevenue && hasAds && <th className="num">CPA</th>}
            {hasRevenue && hasAds && full && <th className="num">ROI</th>}
            {hasRevenue && full && <th className="num">Reemb.</th>}
            {hasRevenue && <th className="num">{dim === 'productId' ? 'Lucro' : 'Contribuição'}</th>}
            {hasRevenue && full && <th className="num">Margem</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const target = targetCpa?.(r.key);
            const overCpa = target && r.cpa !== null && r.cpa > target;
            return (
              <tr key={r.key}>
                <td>{nameOf(r.key)}</td>
                {hasRevenue && full && <td className="num">{num(r.units)}</td>}
                {hasRevenue && <td className="num">{m(r.gross)}</td>}
                {hasRevenue && full && <td className="num">{m(r.net)}</td>}
                {hasAds &&
                  (hasRevenue ? (
                    <td className="num">{m(r.ads)}</td>
                  ) : (
                    <td>
                      <div className="bar-cell">
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width: `${(r.ads / maxAds) * 100}%` }} />
                        </div>
                        <span style={{ minWidth: 110, textAlign: 'right' }}>{m(r.ads)}</span>
                      </div>
                    </td>
                  ))}
                {hasRevenue && hasAds && <td className="num">{ratio(r.roas)}</td>}
                {hasRevenue && hasAds && (
                  <td className={`num ${overCpa ? 'neg' : ''}`} title={target ? `CPA máximo: ${m(target)}` : undefined}>
                    {r.cpa === null ? '—' : m(r.cpa)}
                    {overCpa ? ' ⚠' : ''}
                  </td>
                )}
                {hasRevenue && hasAds && full && <td className={`num ${r.roi !== null && r.roi < 0 ? 'neg' : ''}`}>{pct(r.roi)}</td>}
                {hasRevenue && full && <td className="num">{pct(r.refundRate)}</td>}
                {hasRevenue && <td className={`num ${r.profit < 0 ? 'neg' : 'pos'}`}>{m(r.profit)}</td>}
                {hasRevenue && full && <td className="num">{pct(r.margin)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
