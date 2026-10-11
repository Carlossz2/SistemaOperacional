const PATHS: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  sales: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  ads: 'M3 11l18-8v18L3 13v-2zm4 2v6',
  expenses: 'M3 6h18M7 6V4h10v2M6 6l1 15h10l1-15',
  capital: 'M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6',
  products: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  reports: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13.7H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10.3 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  close: 'M6 6l12 12M18 6L6 18',
  menu: 'M3 6h18M3 12h18M3 18h18',
  download: 'M12 3v12m0 0l-5-5m5 5l5-5M4 21h16',
  upload: 'M12 21V9m0 0l-5 5m5-5l5 5M4 3h16',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  flow: 'M3 3h18v18H3zM7 15l3-4 3 3 4-6',
  pie: 'M21 12A9 9 0 1 1 12 3M21 12A9 9 0 0 0 12 3v9h9z',
  wallet: 'M3 7h18v13H3zM3 7l2-4h12l2 4M16 13.5h2',
  cash: 'M2 6h20v12H2zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  coins: 'M9 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM15 10.2A6 6 0 1 1 9.8 16',
  calendar: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  logo: 'M5 5h6v6H5zM13 13h6v6h-6zM13 5h6v6h-6z',
  cloud: 'M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8H7z',
  plug: 'M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
