// Modelo de dados do CADIGITAL.
// Todo lançamento em moeda estrangeira guarda a cotação usada no dia (`rate`),
// para que relatórios antigos não mudem quando o câmbio muda.

export type ID = string;

export interface Product {
  id: ID;
  name: string;
  /** Mercado principal / idioma da oferta, ex: "LATAM", "BR", "US" */
  market: string;
  kind: 'front' | 'upsell' | 'downsell' | 'orderbump' | 'recorrente' | 'outro';
  active: boolean;
  /** Meta de CPA máximo na moeda base (opcional) */
  targetCpa?: number;
}

interface MoneyEntry {
  id: ID;
  /** AAAA-MM-DD */
  date: string;
  currency: string;
  /** Quantas unidades da moeda base valem 1 unidade de `currency` no dia do lançamento */
  rate: number;
  notes?: string;
}

/** Receita: pode ser uma venda individual ou o consolidado do dia de uma plataforma. */
export interface Sale extends MoneyEntry {
  productId: ID;
  /** Plataforma de pagamento: Hotmart, Kiwify, ClickBank, Digistore24, Stripe... */
  platform: string;
  /** Código do país (BR, MX, US, CO...) */
  country: string;
  quantity: number;
  /** Valor bruto cobrado do cliente */
  gross: number;
  /** Taxas da plataforma/gateway, afiliados, impostos retidos */
  fees: number;
  /** Reembolsos + chargebacks */
  refunds: number;
  /** Campanha de origem (opcional), para medir o ROI por campanha */
  campaign?: string;
  /** manual = lançado no app; auto = consolidado das vendas recebidas por webhook (somente leitura) */
  origin?: 'manual' | 'auto';
}

/** Investimento em tráfego pago. */
export interface AdSpend extends MoneyEntry {
  /** Vazio quando um gasto sincronizado não tem produto associado */
  productId: ID;
  /** Meta Ads, Google Ads, TikTok Ads, Native... */
  source: string;
  campaign?: string;
  country: string;
  amount: number;
  /** manual = lançado no app; meta = sincronizado da Meta Ads (somente leitura) */
  origin?: 'manual' | 'meta';
  metrics?: Record<string, number> | null;
}

export type Recurrence = 'none' | 'monthly';

/** Custos operacionais: ferramentas, equipe, criativos etc. */
export interface Expense extends MoneyEntry {
  category: string;
  description: string;
  amount: number;
  productId?: ID;
  recurrence: Recurrence;
  /** Para recorrentes: último mês (AAAA-MM) em que a despesa ainda é cobrada */
  endMonth?: string;
}

/**
 * Movimentações de capital que não são custo operacional:
 * aporte = dinheiro que entra dos sócios; retirada = pró-labore/distribuição de lucro;
 * investimento = compra de ativo (equipamento, curso, aquisição de oferta...).
 */
export interface CapitalMove extends MoneyEntry {
  kind: 'aporte' | 'retirada' | 'investimento';
  description: string;
  amount: number;
}

export interface Settings {
  baseCurrency: string;
  /** Cotações padrão: 1 unidade da moeda = X na moeda base */
  rates: Record<string, number>;
  /** Alíquota estimada de imposto sobre a receita líquida (%), ex: Simples Nacional */
  taxRate: number;
  businessName: string;
  /** Fuso usado para definir o dia das vendas recebidas por webhook */
  timezone: string;
  platforms: string[];
  adSources: string[];
  expenseCategories: string[];
}

export interface Database {
  version: 1;
  settings: Settings;
  products: Product[];
  sales: Sale[];
  ads: AdSpend[];
  expenses: Expense[];
  capital: CapitalMove[];
}

export type Collection = 'products' | 'sales' | 'ads' | 'expenses' | 'capital';
