import { useState } from 'react';
import { Icon } from './Icon';
import { addMonths, today } from '../lib/dates';
import { cancelExpense, EXPENSE_STATUS, pauseExpense, reactivateExpense, statusOf } from '../lib/expenseStatus';
import { upsert } from '../lib/store';
import type { Expense, ExpenseStatus } from '../lib/types';

const mm = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
const thisMonth = () => today().slice(0, 7);

type Action = 'pause' | 'cancel' | 'reactivate';

/** Etiqueta de status na tabela + ações (pausar, cancelar, reativar). */
export function ExpenseStatusCell({ expense: e }: { expense: Expense }) {
  const [action, setAction] = useState<Action | null>(null);
  const st = statusOf(e, thisMonth());
  const monthly = e.recurrence === 'monthly';
  const note =
    st === 'paused' && e.pausedFrom
      ? `sem cobrança desde ${mm(e.pausedFrom)}`
      : st === 'canceled' && monthly && e.endMonth
        ? `última cobrança ${mm(e.endMonth)}`
        : st === 'active' && monthly && e.endMonth
          ? `até ${mm(e.endMonth)}`
          : '';
  const actions: { key: Action; label: string }[] =
    st === 'active'
      ? [...(monthly ? [{ key: 'pause' as const, label: 'Pausar' }] : []), { key: 'cancel', label: 'Cancelar' }]
      : st === 'paused'
        ? [
            { key: 'reactivate', label: 'Reativar' },
            { key: 'cancel', label: 'Cancelar' },
          ]
        : [{ key: 'reactivate', label: 'Reativar' }];
  return (
    <div className="status-cell">
      <details className="menu">
        <summary className={`status ${EXPENSE_STATUS[st].tone}`} title="Mudar o status" aria-label={`Status de ${e.description}: ${EXPENSE_STATUS[st].label}`}>
          {EXPENSE_STATUS[st].label} <Icon name="chevron" size={12} />
        </summary>
        <div className="menu-list" onClick={(ev) => (ev.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}>
          {actions.map((a) => (
            <button key={a.key} type="button" onClick={() => setAction(a.key)}>
              {a.label}
            </button>
          ))}
        </div>
      </details>
      {note && <div className="muted small">{note}</div>}
      {action && <StatusDialog expense={e} action={action} onClose={() => setAction(null)} />}
    </div>
  );
}

function StatusDialog({ expense: e, action, onClose }: { expense: Expense; action: Action; onClose: () => void }) {
  const monthly = e.recurrence === 'monthly';
  // pausar: a cobrança deste mês normalmente já saiu → para a partir do próximo
  const [month, setMonth] = useState(action === 'pause' ? addMonths(thisMonth(), 1) : thisMonth());
  const title = { pause: 'Pausar despesa', cancel: 'Cancelar despesa', reactivate: 'Reativar despesa' }[action];
  const label = { pause: 'Sem cobrança a partir de', cancel: 'Último mês cobrado', reactivate: 'Volta a cobrar em' }[action];
  const explain = !monthly
    ? action === 'cancel'
      ? 'Despesa única cancelada deixa de contar nos custos e no lucro.'
      : 'A despesa volta a contar nos custos e no lucro.'
    : action === 'pause'
      ? `Os meses a partir de ${mm(month)} ficam sem cobrança até você reativar. Os meses anteriores não mudam.`
      : action === 'cancel'
        ? `Cobrada até ${mm(month)}; depois disso, não entra mais nos custos. Os meses anteriores não mudam.`
        : `Volta a ser cobrada a partir de ${mm(month)}. O período parado continua sem cobrança no histórico.`;
  const save = () => {
    const next = action === 'pause' ? pauseExpense(e, month) : action === 'cancel' ? cancelExpense(e, month) : reactivateExpense(e, month);
    upsert('expenses', next);
    onClose();
  };
  return (
    <div className="modal-bg" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} style={{ width: 'min(460px, 100%)' }}>
        <div className="modal-head">
          <div>
            <h2 style={{ margin: 0 }}>{title}</h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>{e.description}</p>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        {monthly && (
          <label className="field">
            {label}
            <input type="month" aria-label={label} value={month} onChange={(ev) => ev.target.value && setMonth(ev.target.value)} min={e.date.slice(0, 7)} />
          </label>
        )}
        <p className="small" style={{ margin: '12px 0 0' }}>{explain}</p>
        <div className="modal-foot">
          <button type="button" onClick={onClose}>Voltar</button>
          <button type="button" className={action === 'cancel' ? 'danger' : 'primary'} onClick={save}>
            {title.split(' ')[0]}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Filtro por status (com contagem) para o topo da aba Despesas. */
export function ExpenseStatusFilter({ items, value, onChange }: { items: Expense[]; value: ExpenseStatus | ''; onChange: (v: ExpenseStatus | '') => void }) {
  const count = (s: ExpenseStatus) => items.filter((e) => statusOf(e, thisMonth()) === s).length;
  return (
    <div className="segmented" role="tablist" aria-label="Filtrar por status">
      <button role="tab" aria-selected={value === ''} className={value === '' ? 'on' : ''} onClick={() => onChange('')}>
        Todas ({items.length})
      </button>
      {(Object.keys(EXPENSE_STATUS) as ExpenseStatus[]).map((s) => (
        <button key={s} role="tab" aria-selected={value === s} className={value === s ? 'on' : ''} onClick={() => onChange(s)}>
          {EXPENSE_STATUS[s].label}s ({count(s)})
        </button>
      ))}
    </div>
  );
}
