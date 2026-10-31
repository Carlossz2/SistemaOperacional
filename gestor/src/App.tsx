import { useEffect, useState } from 'react';
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { PeriodProvider } from './lib/period';
import { Icon } from './components/Icon';
import { LogoMark } from './components/Logo';
import { promptInstall, usePwa, useUpdating } from './lib/pwa';
import { CloudGate, signOut } from './components/CloudGate';
import { useSyncStatus } from './lib/cloud/sync';
import { isCloudActive } from './lib/store';
import { Integrations } from './pages/Integrations';
import { Dashboard } from './pages/Dashboard';
import { AdsPage, CapitalPage, ExpensesPage, ProductsPage, SalesPage } from './pages/Entries';
import { Reports } from './pages/Reports';
import { Costs } from './pages/Costs';
import { Documents } from './pages/Documents';
import { Settings } from './pages/Settings';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/custos', label: 'Controle de custos', icon: 'calendar' },
  { to: '/receitas', label: 'Receitas', icon: 'sales' },
  { to: '/trafego', label: 'Tráfego pago', icon: 'ads' },
  { to: '/despesas', label: 'Despesas', icon: 'expenses' },
  { to: '/caixa', label: 'Caixa & capital', icon: 'capital' },
  { to: '/documentos', label: 'Documentos', icon: 'folder' },
  { to: '/produtos', label: 'Produtos', icon: 'products' },
  { to: '/relatorios', label: 'Relatórios', icon: 'reports' },
  { to: '/integracoes', label: 'Integrações', icon: 'plug' },
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
        <b>CADIGITAL</b>
      </div>
      {open && <div className="drawer-bg" onClick={() => setOpen(false)} />}
      <div className="shell">
        <aside className={`sidebar ${open ? 'open' : ''}`}>
          <div className="brand">
            <span className="brand-logo">
              <LogoMark size={22} />
            </span>
            <span className="brand-name">CADIGITAL</span>
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
            <SaveIndicator />
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
            {isCloudActive() && (
              <button className="nav-link" onClick={() => void signOut()} data-tip="Sair" aria-label="Sair">
                <Icon name="logout" />
                <span className="nav-label">Sair</span>
              </button>
            )}
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
            <Route path="/custos" element={<Costs />} />
            <Route path="/semanal" element={<Navigate to="/custos" replace />} />
            <Route path="/documentos" element={<Documents />} />
            <Route path="/configuracoes" element={<Settings />} />
            <Route path="/integracoes" element={<Integrations />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </main>
      </div>
    </>
  );
}

const SAVE_LABEL: Record<string, string> = {
  idle: 'Dados neste navegador',
  loading: 'Carregando da nuvem…',
  saving: 'Salvando na nuvem…',
  saved: 'Tudo salvo na nuvem',
  offline: 'Sem conexão — alterações guardadas para enviar',
  error: 'Erro ao salvar',
};

/** Indicador de salvamento (bolinha verde = tudo salvo na nuvem). */
function SaveIndicator() {
  const st = useSyncStatus();
  const cloud = isCloudActive();
  const label = cloud
    ? `${SAVE_LABEL[st.state]}${st.pending ? ` (${st.pending} pendente${st.pending > 1 ? 's' : ''})` : ''}`
    : 'Dados só neste navegador';
  return (
    <NavLink to="/configuracoes" className="nav-link" data-tip={label} aria-label={label} style={{ position: 'relative' }}>
      <Icon name="cloud" />
      <span className="nav-label">{label}</span>
      <i className={`save-dot ${cloud ? st.state : 'offline'}`} />
    </NavLink>
  );
}

/** Aviso flutuante quando algo não pôde ser salvo (ou quando o app está se atualizando). */
function SyncToast() {
  const st = useSyncStatus();
  const updating = useUpdating();
  const [hidden, setHidden] = useState('');
  if (updating) return <div className="toast warn" role="status">Nova versão da CADIGITAL disponível — atualizando…</div>;
  if (!isCloudActive() || !st.message || hidden === st.message || (st.state !== 'error' && st.state !== 'offline')) return null;
  return (
    <div className={`toast ${st.state === 'offline' ? 'warn' : ''}`} role="status">
      <span style={{ flex: 1 }}>{st.message}</span>
      <button className="ghost" onClick={() => setHidden(st.message ?? '')} aria-label="Fechar">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function App() {
  return (
    <CloudGate>
      <HashRouter>
        <PeriodProvider>
          <Shell />
          <SyncToast />
        </PeriodProvider>
      </HashRouter>
    </CloudGate>
  );
}
