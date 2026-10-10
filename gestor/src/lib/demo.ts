import type { Database } from './types';
import { addDays, today } from './dates';
import { DEFAULT_SETTINGS, uid } from './store';

/** Gera ~90 dias de uma operação fictícia (BR + LATAM + US) para explorar o sistema. */
export function demoDb(ref = today()): Database {
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.businessName = 'Operação Demo';
  const products = [
    { id: uid(), name: 'Reconquista Express (LATAM)', market: 'LATAM', kind: 'front' as const, active: true, targetCpa: 120 },
    { id: uid(), name: 'Método Fitness 21D (BR)', market: 'BR', kind: 'front' as const, active: true, targetCpa: 90 },
    { id: uid(), name: 'Keto Blueprint (US)', market: 'US', kind: 'front' as const, active: true, targetCpa: 250 },
  ];
  const [latam, br, us] = products;
  const db: Database = { version: 1, settings, products, sales: [], ads: [], expenses: [], capital: [] };

  const offers = [
    { p: latam, platform: 'Hotmart', currency: 'USD', ticket: 27, countries: ['MX', 'CO', 'AR', 'CL', 'PE'], source: 'Meta Ads', spend: 260 },
    { p: br, platform: 'Kiwify', currency: 'BRL', ticket: 197, countries: ['BR'], source: 'Meta Ads', spend: 1500 },
    { p: us, platform: 'ClickBank', currency: 'USD', ticket: 69, countries: ['US', 'CA'], source: 'Google Ads', spend: 380 },
  ];

  for (let i = 89; i >= 0; i--) {
    const date = addDays(ref, -i);
    const growth = 0.6 + (90 - i) / 150;
    for (const o of offers) {
      const country = o.countries[Math.floor(rand() * o.countries.length)];
      const rate = settings.rates[o.currency] ?? 1;
      const spend = Math.round(o.spend * growth * (0.7 + rand() * 0.6));
      const roas = 1.2 + rand() * 1.6;
      const units = Math.max(0, Math.round((spend * roas) / o.ticket));
      const gross = units * o.ticket;
      db.ads.push({ id: uid(), date, productId: o.p.id, source: o.source, country, currency: o.currency, rate, amount: spend });
      if (units > 0) {
        db.sales.push({
          id: uid(),
          date,
          productId: o.p.id,
          platform: o.platform,
          country,
          currency: o.currency,
          rate,
          quantity: units,
          gross,
          fees: Math.round(gross * 0.099 * 100) / 100,
          refunds: rand() < 0.3 ? o.ticket * Math.ceil(rand() * 2) : 0,
        });
      }
    }
  }

  const start = addDays(ref, -89);
  const monthly = (category: string, description: string, amount: number, currency = 'BRL') =>
    db.expenses.push({
      id: uid(),
      date: start,
      category,
      description,
      amount,
      currency,
      rate: settings.rates[currency] ?? 1,
      recurrence: 'monthly',
    });
  monthly('Ferramentas / SaaS', 'VTurb', 197);
  monthly('Ferramentas / SaaS', 'Utmify', 147);
  monthly('Hospedagem / Domínios', 'Hostinger', 60);
  monthly('Equipe / Freelancers', 'Gestor de tráfego', 4000);
  monthly('Copy / Criativos', 'Editor de vídeo', 2500);
  monthly('Contabilidade', 'Contador', 450);
  db.expenses.push({
    id: uid(),
    date: addDays(ref, -40),
    category: 'Contingência (perfis, BMs)',
    description: 'Lote de BMs',
    amount: 900,
    currency: 'BRL',
    rate: 1,
    recurrence: 'none',
  });

  db.capital.push(
    { id: uid(), date: start, kind: 'aporte', description: 'Capital inicial', amount: 30000, currency: 'BRL', rate: 1 },
    { id: uid(), date: addDays(ref, -60), kind: 'investimento', description: 'Notebook para edição', amount: 9000, currency: 'BRL', rate: 1 },
    { id: uid(), date: addDays(ref, -30), kind: 'retirada', description: 'Pró-labore', amount: 8000, currency: 'BRL', rate: 1 },
  );
  return db;
}
