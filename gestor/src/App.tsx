import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PeriodProvider } from './lib/period';
import { Icon } from './components/Icon';
import { promptInstall, usePwa } from './lib/pwa';
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
      return (localStorage.getItem('gestor-dr:theme') as Theme) || 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    const resolved = theme === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
    document.documentElement.setAttribute('data-theme', resolved);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f3f4f6' : '#0b0c0e');
    try {
      localStorage.setItem('gestor-dr:theme', theme);
    } catch {
      /* ignora */
    }
  }, [theme]);
  const isDark = theme === 'dark' || (theme === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
  return [theme, () => setTheme(isDark ? 'light' : 'dark')];
}

function Shell() {
  const [open, setOpen] = useState(false);
  const [theme, toggle] = useTheme();
  const pwa = usePwa();
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const dark = theme === 'dark' || (theme === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);

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
              <Icon name="logo" size={16} />
            </span>
            <span className="brand-name">Gestor DR</span>
          </div>
          {NAV.filter((n) => n.to !== '/configuracoes').map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              data-tip={n.label}
              aria-label={n.label}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <Icon name={n.icon} />
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
          <div className="sidebar-foot">
            {pwa.canInstall && (
              <button className="nav-link install" onClick={promptInstall} data-tip="Instalar app" aria-label="Instalar app">
                <Icon name="download" />
                <span className="nav-label">Instalar app</span>
              </button>
            )}
            <button className="nav-link" onClick={toggle} data-tip={dark ? 'Tema claro' : 'Tema escuro'} aria-label="Alternar tema">
              <Icon name={dark ? 'sun' : 'moon'} />
              <span className="nav-label">{dark ? 'Tema claro' : 'Tema escuro'}</span>
            </button>
            <NavLink
              to="/configuracoes"
              data-tip="Configurações"
              aria-label="Configurações"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <Icon name="settings" />
              <span className="nav-label">Configurações</span>
            </NavLink>
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
