import { useSyncExternalStore } from 'react';

// Instalação como app (PWA): registra o service worker e guarda o convite de instalação do navegador.

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function setupPwa() {
  installed = isStandalone();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          // procura versão nova periodicamente e ao voltar para o app
          const check = () => reg.update().catch(() => undefined);
          setInterval(check, 30 * 60_000);
          document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
        })
        .catch(() => {
          /* ambiente sem suporte (ex.: pré-visualização embutida) — o app funciona normalmente */
        });
      // quando a versão nova assume, recarrega (sem interromper um formulário aberto)
      const hadController = Boolean(navigator.serviceWorker.controller);
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        reloading = true;
        updating = true;
        emit();
        const tryReload = () => {
          if (document.querySelector('.modal')) return setTimeout(tryReload, 3000);
          location.reload();
        };
        setTimeout(tryReload, 1200);
      });
    });
  }
}

let updating = false;
export const useUpdating = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => updating,
  );

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  emit();
  return outcome === 'accepted';
}

export function usePwa() {
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => `${Boolean(deferred)}|${installed}`,
  );
  const [canInstall, isInstalled] = snapshot.split('|').map((x) => x === 'true');
  return { canInstall, installed: isInstalled };
}
