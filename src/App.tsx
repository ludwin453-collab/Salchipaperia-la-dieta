import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChefHat,
  ChevronRight,
  LogOut,
  PanelLeft,
  RefreshCw,
  ShieldCheck,
  UtensilsCrossed,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { OutboxMutation, PosBootstrapState, User } from './types/pos';
import {
  enqueueOutboxMutation,
  flushOutboxQueue,
  loadCachedState,
  loadOutbox,
  saveCachedState,
} from './lib/offlineClient';
import {
  playKitchenOrderBell,
  playWaiterReadyBell,
  unlockAudioContext,
} from './lib/audioAlert';
import { LaDietaLogo } from './components/LaDietaBrand';
import { LoginScreen } from './components/LoginScreen';
import { WaiterView } from './components/WaiterView';
import { KitchenKdsView } from './components/KitchenKdsView';
import { CashierView } from './components/CashierView';
import { AdminView } from './components/AdminView';

type ModuleTab = 'MOZOS' | 'COCINA' | 'CAJA' | 'ADMIN';

const MODULE_META: Record<
  ModuleTab,
  {
    label: string;
    shortLabel: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  MOZOS: {
    label: 'Mozos',
    shortLabel: 'Mozos',
    description: 'Mesas, clientes y toma de pedidos',
    icon: UtensilsCrossed,
  },
  COCINA: {
    label: 'Cocina',
    shortLabel: 'Cocina',
    description: 'Monitor KDS y preparación FIFO',
    icon: ChefHat,
  },
  CAJA: {
    label: 'Caja',
    shortLabel: 'Caja',
    description: 'Cobros, cuentas divididas y tickets',
    icon: Wallet,
  },
  ADMIN: {
    label: 'Administración',
    shortLabel: 'Admin',
    description: 'Carta, inventario, reportes y mozos',
    icon: ShieldCheck,
  },
};

const SESSION_KEY = 'la_dieta_session_user_v1';
const GATE_TOKEN_KEY = 'la_dieta_app_gate_token_v1';

export default function App() {
  const [gateToken, setGateToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(GATE_TOKEN_KEY);
    } catch {
      return null;
    }
  });

  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTab] = useState<ModuleTab>('MOZOS');
  const [mobileRoleBarOpen, setMobileRoleBarOpen] = useState(false);
  const [state, setState] = useState<PosBootstrapState | null>(() => loadCachedState());
  const [outbox, setOutbox] = useState<OutboxMutation[]>(() => loadOutbox());
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [wsConnected, setWsConnected] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' | 'warn' } | null>(null);

  const isEffectiveOnline = browserOnline && !simulatedOffline;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const showToast = useCallback((msg: string, type: 'ok' | 'err' | 'warn' = 'ok') => {
    setToast({ msg, type });
    window.setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev));
    }, 4200);
  }, []);

  const allowedTabs = useMemo<ModuleTab[]>(() => {
    if (!currentUser) return [];
    switch (currentUser.roleName) {
      case 'ADMINISTRADOR':
        return ['MOZOS', 'COCINA', 'CAJA', 'ADMIN'];
      case 'MOZO':
        return ['MOZOS'];
      case 'COCINERO':
        return ['COCINA'];
      case 'CAJERO':
        return ['CAJA', 'MOZOS'];
      default:
        return ['MOZOS'];
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && !allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [currentUser, allowedTabs, activeTab]);

  useEffect(() => {
    if (!mobileRoleBarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileRoleBarOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileRoleBarOpen]);

  const fetchFullState = useCallback(async () => {
    if (!currentUser || !isEffectiveOnline) return;
    try {
      const res = await fetch('/api/state', {
        headers: { 'x-user-id': currentUser.id },
      });
      if (res.status === 401) {
        setCurrentUser(null);
        sessionStorage.removeItem(SESSION_KEY);
        return;
      }
      if (!res.ok) return;
      const fresh = (await res.json()) as PosBootstrapState;
      setState(fresh);
      saveCachedState(fresh);
    } catch {
      // Mantiene caché offline
    }
  }, [currentUser, isEffectiveOnline]);

  const syncPendingOutbox = useCallback(async () => {
    if (!currentUser || !isEffectiveOnline) return;
    const { remaining, syncedCount } = await flushOutboxQueue(currentUser.id, simulatedOffline);
    setOutbox(remaining);
    if (syncedCount > 0) {
      showToast(`Sincronización completada: ${syncedCount} operación(es) enviadas.`, 'ok');
      await fetchFullState();
    }
  }, [currentUser, isEffectiveOnline, simulatedOffline, fetchFullState, showToast]);

  // Listeners de red real del navegador y desbloqueo de audio en primer toque
  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    const onUnlockAudio = () => unlockAudioContext();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pointerdown', onUnlockAudio, { passive: true });
    window.addEventListener('keydown', onUnlockAudio, { passive: true });
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pointerdown', onUnlockAudio);
      window.removeEventListener('keydown', onUnlockAudio);
    };
  }, []);

  // Carga inicial y auto-sincronización al recuperar conexión
  useEffect(() => {
    if (!currentUser) return;
    if (isEffectiveOnline) {
      void syncPendingOutbox().then(() => fetchFullState());
    }
  }, [currentUser, isEffectiveOnline, syncPendingOutbox, fetchFullState]);

  // WebSocket en tiempo real con reconexión automática
  useEffect(() => {
    if (!currentUser || !isEffectiveOnline) {
      setWsConnected(false);
      return;
    }

    let closedByCleanup = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onopen = () => {
        setWsConnected(true);
      };
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string) as {
            event?: string;
            payload?: { status?: string; deliveryWaiterId?: string | null };
          };
          if (msg.event === 'NEW_ORDER' && (activeTabRef.current === 'COCINA' || currentUser.roleName === 'COCINERO')) {
            playKitchenOrderBell();
          }
          if (
            msg.event === 'ORDER_STATUS_CHANGED' &&
            (msg.payload?.status === 'LISTO' || msg.payload?.status === 'ENTREGADO') &&
            (activeTabRef.current === 'MOZOS' || currentUser.roleName === 'MOZO')
          ) {
            const assignedWaiterId = msg.payload?.deliveryWaiterId;
            if (!assignedWaiterId || assignedWaiterId === currentUser.id || currentUser.roleName !== 'MOZO') {
              playWaiterReadyBell();
            }
          }
          void fetchFullState();
        } catch {
          void fetchFullState();
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByCleanup) {
          reconnectTimer = window.setTimeout(connect, 2500);
        }
      };
    };

    connect();
    return () => {
      closedByCleanup = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [currentUser, isEffectiveOnline, fetchFullState]);

  const handleApiAction = useCallback(
    async (
      method: 'POST' | 'PATCH' | 'DELETE',
      url: string,
      body: unknown,
      description: string,
      queueIfOffline = false
    ): Promise<unknown> => {
      if (!currentUser) return false;

      if (!isEffectiveOnline) {
        if (queueIfOffline) {
          const updated = enqueueOutboxMutation(method, url, body, description);
          setOutbox(updated);
          showToast(`Sin conexión: "${description}" guardado en cola local para sincronizar.`, 'warn');
          return true;
        }
        showToast('Sin conexión al servidor local. Activa la red para esta operación.', 'err');
        return false;
      }

      const idempotencyKey = crypto.randomUUID();
      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUser.id,
            'Idempotency-Key': idempotencyKey,
          },
          body: method === 'DELETE' && body === undefined ? undefined : JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          showToast(data.error ?? 'No se pudo completar la operación.', 'err');
          return false;
        }
        await fetchFullState();
        showToast(`${description} completado.`, 'ok');
        return data;
      } catch {
        if (queueIfOffline) {
          const updated = enqueueOutboxMutation(method, url, body, description);
          setOutbox(updated);
          showToast(`Red interrumpida: "${description}" conservado en cola offline.`, 'warn');
          return true;
        }
        showToast('Error de red al comunicarse con el servidor.', 'err');
        return false;
      }
    },
    [currentUser, isEffectiveOnline, fetchFullState, showToast]
  );

  const handleGateUnlocked = useCallback((token: string) => {
    sessionStorage.setItem(GATE_TOKEN_KEY, token);
    setGateToken(token);
  }, []);

  const handleLockApp = useCallback(() => {
    sessionStorage.removeItem(GATE_TOKEN_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    setGateToken(null);
    setCurrentUser(null);
    setMobileRoleBarOpen(false);
  }, []);

  const handleLogin = (user: User) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    setCurrentUser(user);
    setMobileRoleBarOpen(false);
    if (user.roleName === 'COCINERO') setActiveTab('COCINA');
    else if (user.roleName === 'CAJERO') setActiveTab('CAJA');
    else if (user.roleName === 'ADMINISTRADOR') setActiveTab('ADMIN');
    else setActiveTab('MOZOS');
  };

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    setMobileRoleBarOpen(false);
    setCurrentUser(null);
  };

  if (!gateToken || !currentUser) {
    return (
      <LoginScreen
        gateToken={gateToken}
        onGateUnlocked={handleGateUnlocked}
        onLockApp={handleLockApp}
        onLoginSuccess={handleLogin}
      />
    );
  }

  const activeMeta = MODULE_META[activeTab];

  return (
    <div className="min-h-screen bg-[#111111] text-white">
      {/* Barra superior 3 zonas (en móvil reemplaza los tabs comprimidos por botón claro a la barra vertical) */}
      <header className="no-print sticky top-0 z-40 border-b border-[#262626] bg-[#111111]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-3 py-2.5 sm:px-6 md:gap-8 md:py-3">
          {/* Zona 1: Marca */}
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <LaDietaLogo size={36} />
            <span className="font-display text-base font-extrabold tracking-tight text-[#FFD600] sm:text-lg">
              LA DIETA
            </span>
          </div>

          {/* Zona 2 (Desktop/Tablet): Navegación horizontal de módulos permitidos */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold">
            {allowedTabs.map((tab) => {
              const meta = MODULE_META[tab];
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`whitespace-nowrap shrink-0 border-b-2 py-1.5 transition-colors ${
                    activeTab === tab
                      ? 'border-[#FFD600] text-[#FFD600]'
                      : 'border-transparent text-neutral-400 hover:text-white'
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </nav>

          {/* Zona 3: Selector móvil de rol (barra vertical) + Cerrar sesión */}
          <div className="flex items-center gap-2 shrink-0">
            {allowedTabs.length > 1 && (
              <button
                type="button"
                onClick={() => setMobileRoleBarOpen(true)}
                aria-label="Abrir barra vertical de roles"
                aria-expanded={mobileRoleBarOpen}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[#FFD600] px-3.5 py-2 text-xs font-extrabold text-[#111111] transition-colors hover:bg-[#ffe142] whitespace-nowrap shrink-0 md:hidden"
              >
                <PanelLeft className="h-4 w-4 shrink-0" />
                <span>Rol: {activeMeta.shortLabel}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              </button>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="flex min-h-[44px] items-center gap-2 rounded-xl border border-[#2E2E2E] bg-[#1A1A1A] px-3 py-2 text-xs font-bold text-white hover:border-[#E31B23] whitespace-nowrap shrink-0 sm:px-3.5"
            >
              <LogOut className="h-4 w-4 text-[#E31B23]" />
              <span className="hidden sm:inline">Salir ({currentUser.username})</span>
              <span className="sm:hidden">Salir</span>
            </button>
          </div>
        </div>
      </header>

      {/* Barra vertical móvil para seleccionar rol / módulo fácilmente */}
      {mobileRoleBarOpen && allowedTabs.length > 1 && (
        <div className="no-print fixed inset-0 z-50 flex md:hidden">
          <button
            type="button"
            aria-label="Cerrar barra de roles"
            onClick={() => setMobileRoleBarOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
          />

          <aside
            aria-label="Barra vertical de selección de rol"
            className="relative z-10 flex h-full w-[300px] max-w-[86vw] flex-col justify-between border-r border-[#2E2E2E] bg-[#141414] shadow-2xl"
          >
            <div className="flex flex-col">
              {/* Cabecera de la barra vertical */}
              <div className="flex items-center justify-between border-b border-[#262626] px-4 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <LaDietaLogo size={38} />
                  <div className="min-w-0">
                    <p className="font-display text-base font-extrabold text-[#FFD600] truncate">
                      LA DIETA
                    </p>
                    <p className="text-xs text-neutral-400 truncate">
                      {currentUser.fullName} · {currentUser.roleName}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileRoleBarOpen(false)}
                  aria-label="Cerrar panel"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#2E2E2E] bg-[#1C1C1C] text-neutral-300 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Lista vertical grande y legible de roles/módulos */}
              <nav className="flex flex-col gap-3 p-4">
                <p className="px-1 text-xs font-semibold text-neutral-400">
                  Seleccionar rol de trabajo
                </p>
                {allowedTabs.map((tab) => {
                  const meta = MODULE_META[tab];
                  const Icon = meta.icon;
                  const isActive = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab);
                        setMobileRoleBarOpen(false);
                      }}
                      className={`flex min-h-[64px] w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                        isActive
                          ? 'border-[#FFD600] bg-[#FFD600] text-[#111111]'
                          : 'border-[#2B2B2B] bg-[#1B1B1B] text-white hover:border-[#FFD600]/60'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                            isActive ? 'bg-[#111111] text-[#FFD600]' : 'bg-[#262626] text-[#FFD600]'
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-display text-base font-extrabold leading-tight truncate">
                            {meta.label}
                          </p>
                          <p
                            className={`mt-0.5 text-xs leading-snug ${
                              isActive ? 'font-semibold text-[#111111]/80' : 'text-neutral-400'
                            }`}
                          >
                            {meta.description}
                          </p>
                        </div>
                      </div>

                      {isActive ? (
                        <Check className="h-5 w-5 shrink-0 text-[#111111]" />
                      ) : (
                        <ChevronRight className="h-5 w-5 shrink-0 text-neutral-500" />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* Pie de la barra vertical: estado de red y cierre de sesión */}
            <div className="space-y-2.5 border-t border-[#262626] p-4">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Conexión</span>
                <span className={`font-semibold ${wsConnected && isEffectiveOnline ? 'text-emerald-400' : 'text-amber-300'}`}>
                  {isEffectiveOnline ? (wsConnected ? 'Tiempo real' : 'Conectado') : 'Offline'}
                </span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-[#E31B23]/60 bg-[#2A1416] px-4 py-2.5 text-sm font-bold text-red-200 hover:bg-[#3A191C]"
              >
                <LogOut className="h-4 w-4 text-[#E31B23]" />
                <span>Cerrar sesión ({currentUser.username})</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Barra operativa de sincronización y modo offline-first debajo del header */}
      <div className="no-print border-b border-[#222222] bg-[#151515]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs sm:px-6">
          <div className="flex flex-wrap items-center gap-3 text-neutral-300">
            <span className="font-semibold text-white">{currentUser.fullName}</span>
            <span aria-hidden="true">·</span>
            <span>Perfil: {currentUser.roleName}</span>
            <span aria-hidden="true">·</span>
            <span className={`flex items-center gap-1 font-semibold ${wsConnected && isEffectiveOnline ? 'text-emerald-400' : 'text-amber-300'}`}>
              {isEffectiveOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {isEffectiveOnline
                ? wsConnected
                  ? 'Red local conectada (tiempo real)'
                  : 'Conectado'
                : 'Modo Offline activo'}
            </span>
            {outbox.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono font-bold text-[#FFD600] tabular-nums">
                  {outbox.length} pendiente(s) en cola
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSimulatedOffline((v) => !v)}
              className={`rounded-lg border px-3 py-1 font-semibold transition-colors ${
                simulatedOffline
                  ? 'border-amber-400 bg-amber-500/15 text-amber-300'
                  : 'border-[#2E2E2E] bg-[#1C1C1C] text-neutral-300 hover:text-white'
              }`}
            >
              {simulatedOffline ? 'Reconectar Red' : 'Simular Sin Internet'}
            </button>
            {outbox.length > 0 && isEffectiveOnline && (
              <button
                type="button"
                onClick={() => void syncPendingOutbox()}
                className="flex items-center gap-1 rounded-lg bg-[#FFD600] px-3 py-1 font-bold text-[#111111]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Sincronizar ahora</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Notificación flotante */}
      {toast && (
        <div
          role="status"
          className={`no-print fixed right-4 bottom-4 z-50 max-w-sm rounded-xl border px-4 py-3 text-xs font-bold shadow-lg ${
            toast.type === 'err'
              ? 'border-[#E31B23] bg-[#2B1214] text-red-200'
              : toast.type === 'warn'
                ? 'border-amber-500 bg-[#292010] text-amber-200'
                : 'border-emerald-500 bg-[#0F261A] text-emerald-200'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Contenido principal */}
      <main className="mx-auto max-w-[1440px] px-4 pt-6 sm:px-6">
        {!state ? (
          <div className="flex min-h-[320px] items-center justify-center text-sm text-neutral-400">
            Cargando base de datos local de La Dieta...
          </div>
        ) : (
          <>
            {activeTab === 'MOZOS' && (
              <WaiterView
                state={state}
                currentUser={currentUser}
                onApiAction={handleApiAction}
              />
            )}
            {activeTab === 'COCINA' && (
              <KitchenKdsView state={state} onApiAction={handleApiAction} />
            )}
            {activeTab === 'CAJA' && (
              <CashierView
                state={state}
                currentUser={currentUser}
                onApiAction={handleApiAction}
              />
            )}
            {activeTab === 'ADMIN' && (
              <AdminView
                state={state}
                currentUser={currentUser}
                onApiAction={handleApiAction}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
