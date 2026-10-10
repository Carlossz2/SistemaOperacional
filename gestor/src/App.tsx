import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PeriodProvider } from './lib/period';
import { Icon } from './components/Icon';
import { Dashboard } from './pages/Dashboard';
import { AdsPage, CapitalPage, ExpensesPage, ProductsPage, SalesPage } from './pages/Entries';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/receitas', label: 'Receitas', icon: 'sales' },
  { to: '/trafego', label: 'Tráfego pago', icon: 'ads' },
  { to: '/despesas', label: 'Despesas', icon: 'expenses' },
  { to: '/caixa', label: 'Caixa & capital', icon: 'capital' },
  { to: '/produtos', label: 'Produtos', icon: 'products' },
  { to: '/relatorios', label: 'Relatórios', icon: 'reports' },
  { to: '/configuracoes', label: 'Configurações', icon: 'settings' },
];

type Theme = 'light' | 'dark' | 'auto';
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('gestor-dr:theme') as Theme) || 'auto';
    } catch {
      return 'auto';
    }
  });
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('gestor-dr:theme', theme);
    } catch {
      /* ignora */
    }
  }, [theme]);
  const isDark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  return [theme, () => setTheme(isDark ? 'light' : 'dark')];
}

function Shell() {
  const [open, setOpen] = useState(false);
  const [theme, toggle] = useTheme();
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <>
      <div className="mobile-bar">
        <button className="ghost" onClick={() => setOpen(!open)} aria-label="Menu">
          <Icon name="menu" />
        </button>
        <b>Gestor DR</b>
      </div>
      <div className="shell">
        <aside className={`sidebar ${open ? 'open' : ''}`}>
          <div className="brand">
            <span className="brand-logo">
              <Icon name="reports" size={16} />
            </span>
            Gestor DR
          </div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
          <div className="sidebar-foot">
            <button className="ghost" onClick={toggle}>
              <Icon name={dark ? 'sun' : 'moon'} size={16} /> {dark ? 'Tema claro' : 'Tema escuro'}
            </button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/receitas" element={<SalesPage />} />
            <Route path="/trafego" element={<AdsPage />} />
            <Route path="/despesas" element={<ExpensesPage />} />
            <Route path="/caixa" element={<CapitalPage />} />
            <Route path="/produtos" element={<ProductsPage />} />
            <Route path="/relatorios" element={<Reports />} />
            <Route path="/configuracoes" element={<Settings />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </>
  );
}

export function App() {
  return (
    <HashRouter>
      <PeriodProvider>
        <Shell />
      </PeriodProvider>
    </HashRouter>
  );
}
