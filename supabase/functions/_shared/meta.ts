// Meta Ads (Marketing API) — partes puras: montar a consulta e converter o resultado em gastos.

export interface MetaRule {
  /** Trecho do nome da campanha (sem diferenciar maiúsculas) */
  contains: string;
  productId: string;
}

export interface MetaConfig {
  accountIds?: string[];
  rules?: MetaRule[];
  apiVersion?: string;
  /** Quebrar por país (recomendado) */
  byCountry?: boolean;
}

export interface InsightRow {
  account_id?: string;
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  country?: string;
  actions?: { action_type: string; value: string }[];
}

export interface AdRow {
  user_id: string;
  date: string;
  product_id: string | null;
  source: string;
  campaign: string;
  country: string;
  currency: string;
  rate: number;
  amount: number;
  origin: 'meta';
  external_id: string;
  metrics: Record<string, number>;
}

export const DEFAULT_API_VERSION = 'v23.0';

export function normalizeAccount(id: string): string {
  const digits = id.trim().replace(/^act_/i, '');
  return `act_${digits}`;
}

export function insightsUrl(
  account: string,
  token: string,
  since: string,
  until: string,
  cfg: MetaConfig,
  graphBase = 'https://graph.facebook.com',
): string {
  const params = new URLSearchParams({
    level: 'campaign',
    fields: 'account_id,account_currency,campaign_id,campaign_name,spend,impressions,clicks,actions',
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    limit: '500',
    access_token: token,
  });
  if (cfg.byCountry !== false) params.set('breakdowns', 'country');
  return `${graphBase}/${cfg.apiVersion || DEFAULT_API_VERSION}/${normalizeAccount(account)}/insights?${params}`;
}

export function matchProduct(campaign: string, rules: MetaRule[] = [], fallback: string | null = null): string | null {
  const name = campaign.toLowerCase();
  const rule = rules.find((r) => r.contains && name.includes(r.contains.toLowerCase()));
  return rule?.productId ?? fallback;
}

const PURCHASE_ACTIONS = ['purchase', 'offsite_conversion.fb_pixel_purchase', 'omni_purchase'];

export function toAdRow(
  r: InsightRow,
  ctx: { userId: string; account: string; rate: number; rules?: MetaRule[]; defaultProduct: string | null },
): AdRow | null {
  const amount = Number(r.spend ?? 0);
  if (!(amount > 0)) return null;
  const purchases = r.actions?.find((a) => PURCHASE_ACTIONS.includes(a.action_type));
  const country = (r.country && r.country !== 'unknown' ? r.country : '').toUpperCase();
  const account = normalizeAccount(ctx.account);
  return {
    user_id: ctx.userId,
    date: r.date_start,
    product_id: matchProduct(r.campaign_name ?? '', ctx.rules, ctx.defaultProduct),
    source: 'Meta Ads',
    campaign: r.campaign_name ?? r.campaign_id ?? '',
    country: country || '—',
    currency: (r.account_currency || 'BRL').toUpperCase(),
    rate: ctx.rate,
    amount: Math.round(amount * 100) / 100,
    origin: 'meta',
    external_id: `meta:${account}:${r.campaign_id}:${r.date_start}:${country || 'xx'}`,
    metrics: {
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      ...(purchases ? { purchases: Number(purchases.value) } : {}),
    },
  };
}

/** Mensagem amigável para erros comuns da Marketing API. */
export function metaError(err: { code?: number; error_subcode?: number; message?: string } | undefined): string {
  if (!err) return 'Erro desconhecido da Meta';
  if (err.code === 190) return 'Token de acesso da Meta expirado ou inválido — gere um novo token e salve na integração.';
  if (err.code === 10 || err.code === 200 || err.code === 294) return 'Sem permissão para ler esta conta de anúncios (precisa da permissão ads_read).';
  if (err.code === 100) return `Conta de anúncios ou parâmetro inválido: ${err.message ?? ''}`;
  if (err.code === 4 || err.code === 17 || err.code === 613 || err.code === 80004) return 'Limite de chamadas da Meta atingido — a próxima sincronização tenta de novo.';
  return err.message ?? 'Erro da Meta';
}
