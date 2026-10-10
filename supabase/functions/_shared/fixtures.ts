// Exemplos de payload de cada plataforma (usados nos testes).

export const hotmartApproved = {
  id: 'evt-1',
  creation_date: 1760100000000,
  event: 'PURCHASE_APPROVED',
  version: '2.0.0',
  data: {
    product: { id: 1234567, ucode: 'abc', name: 'Método Reconquista' },
    buyer: { email: 'cliente@ex.com', name: 'Cliente', address: { country_iso: 'MX', country: 'México' } },
    purchase: {
      transaction: 'HP1234567890',
      order_date: 1760099000000,
      approved_date: 1760100000000,
      status: 'APPROVED',
      price: { value: 27, currency_value: 'USD' },
      full_price: { value: 27, currency_value: 'USD' },
      payment: { type: 'CREDIT_CARD', installments_number: 1 },
    },
    commissions: [
      { value: 2.5, source: 'MARKETPLACE', currency_value: 'USD' },
      { value: 120.5, source: 'PRODUCER', currency_value: 'BRL' },
    ],
  },
};

export const caktoApproved = {
  secret: 'cakto-secret',
  event: 'purchase_approved',
  data: {
    id: 'ord_abc',
    refId: '7Bx9',
    status: 'paid',
    amount: 197,
    baseAmount: 197,
    discount: 0,
    fees: 9.86,
    paymentMethod: 'pix',
    paidAt: '2026-10-10T15:00:00-03:00',
    createdAt: '2026-10-10T14:58:00-03:00',
    product: { id: 'prod_1', name: 'Método Fitness 21D' },
    offer: { id: 'off_1', name: 'Oferta principal', price: 197 },
    customer: { name: 'Ana', email: 'ana@ex.com' },
  },
};

export const lastlinkConfirmed = {
  Id: 'b1e2',
  IsTest: false,
  Event: 'Purchase_Order_Confirmed',
  CreatedAt: '2026-10-10T13:00:00Z',
  Data: {
    Products: [{ Id: 'LL-PROD', Name: 'Mentoria' }],
    Buyer: { Email: 'b@ex.com', Name: 'Bruno' },
    Purchase: { PaymentId: 'pay_777', Recurrency: 1, PaymentDate: '2026-10-10T13:00:00Z', OriginalPrice: { Value: 497 }, Price: { Value: 397 } },
  },
};

export const ggPaid = {
  event: 'pix.paid',
  createdAt: '2026-10-10T10:00:00-03:00',
  customer: { name: 'Carla', email: 'c@ex.com', document: '000' },
  payment: { id: 'gg_pay_1', amount: 67.9, status: 'paid', paymentMethod: 'pix' },
  product: { id: 'gg_prod', title: 'Ebook Receitas' },
  products: [{ id: 'gg_prod', title: 'Ebook Receitas', type: 'main', price: 47.9 }, { id: 'bump', title: 'Bump', type: 'orderbump', price: 20 }],
};

export const perfectApproved = {
  token: 'pp-token',
  code: 'PPCPMTB5B6RC',
  sale_amount: 197.0,
  currency_enum: 1,
  sale_status_enum: 2,
  sale_status_detail: 'approved',
  date_created: '2026-10-10 09:00:00',
  date_approved: '2026-10-10 09:05:00',
  product: { code: 'PPPB1234', name: 'Kit Emagrecimento' },
  plan: { code: 'PPLQQ1', name: 'Kit 3 potes', quantity: 3 },
  customer: { full_name: 'Diego', email: 'd@ex.com' },
};
