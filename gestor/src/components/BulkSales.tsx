import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { parseBulkSales } from '../lib/bulk';
import { money, num, shortDate } from '../lib/format';
import { uid, upsert, useDb } from '../lib/store';

const EXAMPLE = '31/03/2026;Calyx AI;7;294,10\n14/10/2026;Truco de la reconquista;8;63,77;USD;5,03;MX';

/** Botão + janela "Lançar vários de uma vez" (receitas mensais/históricas coladas de uma lista). */
export function BulkSalesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        <button onClick={() => setOpen(true)} title="Cole uma lista (ex.: totais por mês) e lance tudo de uma vez">
          <Icon name="plus" size={15} /> Lançar vários de uma vez
        </button>
      </div>
      {open && <BulkSales onClose={() => setOpen(false)} />}
    </>
  );
}

function BulkSales({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const [text, setText] = useState('');
  const [done, setDone] = useState<{ sales: number; products: number } | null>(null);
  const parsed = useMemo(
    () => parseBulkSales(text, { baseCurrency: db.settings.baseCurrency, rates: db.settings.rates, defaultPlatform: db.settings.platforms[0] ?? '' }),
    [text, db.settings],
  );
  const findProduct = (name: string) => db.products.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
  const newProducts = [...new Set(parsed.rows.filter((r) => !findProduct(r.productName)).map((r) => r.productName))];
  const total = parsed.rows.reduce((a, r) => a + r.gross * r.rate, 0);

  const save = () => {
    // produtos novos primeiro (as receitas dependem deles)
    const created = new Map<string, string>();
    for (const name of newProducts) {
      const id = uid();
      const latam = parsed.rows.some((r) => r.productName === name && r.currency !== db.settings.baseCurrency);
      upsert('products', { id, name, market: latam ? 'LATAM' : 'BR', kind: 'front', active: true });
      created.set(name.toLowerCase(), id);
    }
    for (const r of parsed.rows) {
      upsert('sales', {
        id: uid(),
        date: r.date,
        productId: findProduct(r.productName)?.id ?? created.get(r.productName.toLowerCase())!,
        platform: r.platform,
        country: r.country,
        currency: r.currency,
        rate: r.rate,
        quantity: r.quantity,
        gross: r.gross,
        fees: 0,
        refunds: 0,
        notes: r.notes || undefined,
        origin: 'manual',
      });
    }
    setDone({ sales: parsed.rows.length, products: newProducts.length });
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-label="Lançar vários de uma vez">
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>Lançar vários de uma vez</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        {done ? (
          <div className="callout">
            <h2>{num(done.sales)} receita(s) lançada(s)</h2>
            <p>{done.products ? `${done.products} produto(s) novo(s) criado(s). ` : ''}Já aparecem no Dashboard, em Receitas e nos relatórios.</p>
          </div>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>
              Uma linha por lançamento, separando com <b>;</b> (ou colando direto de uma planilha):{' '}
              <b>Data ; Produto ; Vendas ; Faturamento bruto</b> — e, se precisar, <b>; Moeda ; Cotação ; País ; Plataforma ; Observações</b>.
              Produtos que não existem são criados com o nome exato.
            </p>
            <textarea
              aria-label="Lista de lançamentos"
              rows={9}
              style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
              placeholder={EXAMPLE}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {parsed.errors.length > 0 && (
              <ul className="form-error small" style={{ margin: '8px 0' }}>
                {parsed.errors.map((e) => (
                  <li key={e.line}>Linha {e.line}: {e.message}</li>
                ))}
              </ul>
            )}
            {parsed.rows.length > 0 && (
              <>
                <p className="small" style={{ margin: '12px 0 8px' }}>
                  <b>{num(parsed.rows.length)} lançamento(s)</b> · {num(parsed.rows.reduce((a, r) => a + r.quantity, 0))} vendas · total {money(total, db.settings.baseCurrency)}
                  {newProducts.length > 0 && ` · produto(s) novo(s): ${newProducts.join(', ')}`}
                </p>
                <div className="table-wrap framed">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Produto</th>
                        <th className="num">Vendas</th>
                        <th className="num">Faturamento</th>
                        <th>País</th>
                        <th>Plataforma</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.map((r) => (
                        <tr key={r.line}>
                          <td>{shortDate(r.date)}</td>
                          <td>
                            {r.productName}
                            {!findProduct(r.productName) && <span className="muted small"> · novo</span>}
                          </td>
                          <td className="num">{num(r.quantity)}</td>
                          <td className="num">
                            {money(r.gross, r.currency)}
                            {r.currency !== db.settings.baseCurrency && <span className="muted small"> ({money(r.gross * r.rate, db.settings.baseCurrency)})</span>}
                          </td>
                          <td>{r.country}</td>
                          <td>{r.platform}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
        <div className="modal-foot">
          <button type="button" onClick={onClose}>{done ? 'Fechar' : 'Cancelar'}</button>
          {!done && (
            <button type="button" className="primary" disabled={!parsed.rows.length || parsed.errors.length > 0} onClick={save}>
              <Icon name="plus" size={15} /> Lançar {parsed.rows.length ? num(parsed.rows.length) : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
