import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Lock,
  ShieldAlert,
  User as UserIcon,
  Users,
} from 'lucide-react';
import type { RoleName, User } from '../types/pos';
import { LaDietaLogo } from './LaDietaBrand';

interface WorkerOption {
  id: string;
  fullName: string;
  username: string;
  roleName: RoleName;
}

interface LoginScreenProps {
  gateToken: string | null;
  onGateUnlocked: (token: string) => void;
  onLockApp: () => void;
  onLoginSuccess: (user: User) => void;
}

const ROLE_BADGE: Record<RoleName, string> = {
  ADMINISTRADOR: 'bg-[#FFD600] text-[#111111]',
  CAJERO: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  COCINERO: 'bg-[#E31B23]/20 text-red-300 border border-[#E31B23]/40',
  MOZO: 'bg-sky-500/20 text-sky-300 border border-sky-500/40',
};

export function LoginScreen({
  gateToken,
  onGateUnlocked,
  onLockApp,
  onLoginSuccess,
}: LoginScreenProps) {
  // Paso 1: Acceso general del aplicativo
  const [gateUsername, setGateUsername] = useState('');
  const [gatePassword, setGatePassword] = useState('');
  const [gateError, setGateError] = useState<string | null>(null);
  const [gateLoading, setGateLoading] = useState(false);

  // Paso 2: Lista de trabajadores y contraseña personal
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [workersLoading, setWorkersLoading] = useState(false);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string>('');
  const [workerPassword, setWorkerPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const workerPassInputRef = useRef<HTMLInputElement | null>(null);
  const sliderRef = useRef<HTMLDivElement | null>(null);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!gateToken) {
      setWorkers([]);
      setSelectedWorkerId('');
      setWorkerPassword('');
      return;
    }

    let cancelled = false;
    const loadWorkers = async () => {
      setWorkersLoading(true);
      setLoginError(null);
      try {
        const res = await fetch('/api/auth/workers', {
          headers: { 'x-app-gate-token': gateToken },
        });
        if (res.status === 401) {
          if (!cancelled) onLockApp();
          return;
        }
        const data = (await res.json()) as { workers?: WorkerOption[]; error?: string };
        if (!res.ok || !data.workers) {
          if (!cancelled) setLoginError(data.error ?? 'No se pudo cargar la lista de trabajadores.');
          return;
        }
        if (!cancelled) {
          setWorkers(data.workers);
          setSelectedWorkerId((prev) =>
            prev && data.workers!.some((w) => w.id === prev) ? prev : data.workers![0]?.id ?? ''
          );
        }
      } catch {
        if (!cancelled) setLoginError('No se pudo conectar con el servidor local.');
      } finally {
        if (!cancelled) setWorkersLoading(false);
      }
    };

    void loadWorkers();
    return () => {
      cancelled = true;
    };
  }, [gateToken, onLockApp]);

  const selectedIndex = Math.max(
    0,
    workers.findIndex((w) => w.id === selectedWorkerId)
  );
  const selectedWorker = workers[selectedIndex] ?? null;

  const selectWorkerAtIndex = (idx: number, focusInput = false) => {
    if (workers.length === 0) return;
    const clamped = ((idx % workers.length) + workers.length) % workers.length;
    const target = workers[clamped];
    if (!target) return;
    setSelectedWorkerId(target.id);
    setWorkerPassword('');
    setLoginError(null);
    if (sliderRef.current) {
      sliderRef.current.scrollTo({
        left: clamped * sliderRef.current.clientWidth,
        behavior: 'smooth',
      });
    }
    if (focusInput) {
      window.setTimeout(() => workerPassInputRef.current?.focus(), 60);
    }
  };

  const handleSliderScroll = () => {
    const el = sliderRef.current;
    if (!el || workers.length === 0 || el.clientWidth === 0) return;
    if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = window.requestAnimationFrame(() => {
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      const clamped = Math.max(0, Math.min(workers.length - 1, idx));
      const target = workers[clamped];
      if (target && target.id !== selectedWorkerId) {
        setSelectedWorkerId(target.id);
        setWorkerPassword('');
        setLoginError(null);
      }
    });
  };

  const handleGateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateError(null);
    setGateLoading(true);
    try {
      const res = await fetch('/api/auth/app-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: gateUsername, password: gatePassword }),
      });
      const data = (await res.json()) as { gateToken?: string; error?: string };
      if (!res.ok || !data.gateToken) {
        setGateError(data.error ?? 'Usuario o contraseña general incorrectos.');
        return;
      }
      setGateUsername('');
      setGatePassword('');
      onGateUnlocked(data.gateToken);
    } catch {
      setGateError('No se pudo conectar con el servidor local.');
    } finally {
      setGateLoading(false);
    }
  };

  const handleWorkerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gateToken || !selectedWorker) return;
    setLoginError(null);
    setLoginLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-app-gate-token': gateToken,
        },
        body: JSON.stringify({
          userId: selectedWorker.id,
          username: selectedWorker.username,
          password: workerPassword,
        }),
      });
      const data = (await res.json()) as { user?: User; error?: string };
      if (res.status === 401 && data.error?.includes('general')) {
        onLockApp();
        return;
      }
      if (!res.ok || !data.user) {
        setLoginError(data.error ?? 'Contraseña incorrecta.');
        return;
      }
      setWorkerPassword('');
      onLoginSuccess(data.user);
    } catch {
      setLoginError('No se pudo conectar con el servidor local.');
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#111111] px-4 py-8">
      <div className="grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-2xl border border-[#2A2A2A] bg-[#181818] lg:grid-cols-12">
        {/* Columna de Identidad Oficial */}
        <div className="flex flex-col justify-between border-b border-[#2A2A2A] bg-[#141414] p-7 lg:col-span-5 lg:border-r lg:border-b-0">
          <div className="space-y-4">
            <LaDietaLogo size={88} />
            <div>
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-white">
                LA DIETA – SALCHIPAPERÍA
              </h1>
              <p className="mt-1 text-sm text-[#FFD600] font-medium">
                ¡Peca rico y sin remordimientos!
              </p>
            </div>
            <p className="text-sm leading-relaxed text-neutral-400">
              Sistema integral de punto de venta, comandas en cocina en tiempo real, control de caja e inventario automático por recetas.
            </p>
          </div>
          <div className="mt-6 border-t border-[#262626] pt-4 text-xs text-neutral-400 space-y-1">
            <p className="text-neutral-300 font-medium">Av. Centenario N.° 401, Sicuani, Canchis, Cusco</p>
            <p>Pedidos y reservas: 963758935 · 963759084</p>
          </div>
        </div>

        {/* Columna de Acceso */}
        <div className="p-6 sm:p-8 lg:col-span-7 flex flex-col justify-between">
          {!gateToken ? (
            /* PASO 1: CONTRASEÑA GENERAL ANTES DE INGRESAR AL APLICATIVO */
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-[#FFD600]/40 bg-[#FFD600]/10 px-3 py-1 text-xs font-bold text-[#FFD600]">
                <KeyRound className="h-3.5 w-3.5" />
                <span>Paso 1 · Acceso General al Aplicativo</span>
              </div>
              <h2 className="mt-3 font-display text-xl font-bold text-white">
                Desbloquear Sistema
              </h2>
              <p className="mt-1 text-sm text-neutral-400">
                Antes de ingresar al aplicativo, introduce el usuario y la contraseña general autorizada.
              </p>

              <form onSubmit={handleGateSubmit} autoComplete="off" className="mt-6 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                    Usuario General
                  </label>
                  <div className="relative">
                    <UserIcon className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                    <input
                      type="text"
                      value={gateUsername}
                      onChange={(e) => setGateUsername(e.target.value)}
                      required
                      autoComplete="off"
                      placeholder="Ingresa el usuario general"
                      className="h-12 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] pr-4 pl-10 text-sm text-white placeholder-neutral-500 focus:border-[#FFD600] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-neutral-300">
                    Contraseña General
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                    <input
                      type="password"
                      value={gatePassword}
                      onChange={(e) => setGatePassword(e.target.value)}
                      required
                      autoComplete="off"
                      placeholder="Ingresa la contraseña general"
                      className="h-12 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] pr-4 pl-10 text-sm text-white placeholder-neutral-500 focus:border-[#FFD600] focus:outline-none"
                    />
                  </div>
                </div>

                {gateError && (
                  <div
                    role="alert"
                    className="rounded-xl border border-[#E31B23]/40 bg-[#E31B23]/15 px-4 py-3 text-sm text-red-200"
                  >
                    {gateError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={gateLoading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-5 text-sm font-extrabold text-[#111111] transition-colors hover:bg-[#f2ca00] disabled:opacity-50"
                >
                  <span>{gateLoading ? 'Verificando...' : 'Continuar a Lista de Trabajadores'}</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>
            </div>
          ) : (
            /* PASO 2: LISTA DE TRABAJADORES + CONTRASEÑA INDIVIDUAL */
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">
                  <Users className="h-3.5 w-3.5" />
                  <span>Paso 2 · Selecciona tu Usuario</span>
                </div>
                <button
                  type="button"
                  onClick={onLockApp}
                  className="flex min-h-[34px] items-center gap-1.5 rounded-lg border border-[#2E2E2E] bg-[#121212] px-3 text-xs font-bold text-neutral-300 hover:border-[#E31B23] hover:text-white"
                >
                  <Lock className="h-3.5 w-3.5 text-[#E31B23]" />
                  <span>Bloquear App</span>
                </button>
              </div>

              <h2 className="mt-3 font-display text-xl font-bold text-white">
                Selecciona tu Usuario
              </h2>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-neutral-400">
                <span>Desliza para ver los trabajadores e ingresa tu clave.</span>
                {workers.length > 0 && (
                  <span className="font-mono font-bold text-[#FFD600] tabular-nums shrink-0">
                    {selectedIndex + 1} / {workers.length}
                  </span>
                )}
              </div>

              {/* Selector deslizable: muestra SOLO UN trabajador a la vez */}
              <div className="mt-3">
                {workersLoading ? (
                  <p className="py-5 text-center text-xs text-neutral-400">Cargando trabajadores...</p>
                ) : workers.length === 0 ? (
                  <p className="py-5 text-center text-xs text-neutral-400">
                    No hay trabajadores activos registrados.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="Trabajador anterior"
                        onClick={() => selectWorkerAtIndex(selectedIndex - 1)}
                        disabled={workers.length <= 1}
                        className="flex h-14 w-10 shrink-0 items-center justify-center rounded-xl border border-[#2E2E2E] bg-[#121212] text-neutral-200 hover:border-[#FFD600] hover:text-[#FFD600] disabled:opacity-35"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>

                      <div
                        ref={sliderRef}
                        onScroll={handleSliderScroll}
                        className="flex flex-1 overflow-x-auto snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      >
                        {workers.map((w) => {
                          const isSelected = w.id === selectedWorker?.id;
                          return (
                            <button
                              key={w.id}
                              type="button"
                              onClick={() => selectWorkerAtIndex(workers.indexOf(w), true)}
                              className={`flex h-14 w-full shrink-0 snap-center items-center justify-between gap-2.5 rounded-xl border px-3.5 text-left transition-colors ${
                                isSelected
                                  ? 'border-[#FFD600] bg-[#221F12]'
                                  : 'border-[#2B2B2B] bg-[#121212]'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-display text-sm font-extrabold text-white truncate">
                                  {w.fullName}
                                </p>
                                <p className="text-[11px] text-neutral-400 truncate">@{w.username}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span
                                  className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold ${ROLE_BADGE[w.roleName]}`}
                                >
                                  {w.roleName}
                                </span>
                                <CheckCircle2 className="h-4 w-4 text-[#FFD600]" />
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        aria-label="Siguiente trabajador"
                        onClick={() => selectWorkerAtIndex(selectedIndex + 1)}
                        disabled={workers.length <= 1}
                        className="flex h-14 w-10 shrink-0 items-center justify-center rounded-xl border border-[#2E2E2E] bg-[#121212] text-neutral-200 hover:border-[#FFD600] hover:text-[#FFD600] disabled:opacity-35"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </div>

                    {workers.length > 1 && (
                      <div className="flex items-center justify-center gap-1.5">
                        {workers.map((w, idx) => (
                          <button
                            key={w.id}
                            type="button"
                            aria-label={`Seleccionar ${w.fullName}`}
                            onClick={() => selectWorkerAtIndex(idx)}
                            className={`h-1.5 rounded-full transition-all ${
                              idx === selectedIndex ? 'w-5 bg-[#FFD600]' : 'w-1.5 bg-neutral-600 hover:bg-neutral-400'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Formulario de contraseña para el trabajador seleccionado */}
              {selectedWorker && (
                <form onSubmit={handleWorkerLogin} autoComplete="off" className="mt-4 space-y-3 border-t border-[#262626] pt-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-400">
                      Ingresando como:{' '}
                      <strong className="text-[#FFD600]">{selectedWorker.fullName}</strong>
                    </span>
                    <span className="font-mono text-neutral-400">@{selectedWorker.username}</span>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-neutral-300">
                      Contraseña personal
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                      <input
                        ref={workerPassInputRef}
                        type="password"
                        value={workerPassword}
                        onChange={(e) => setWorkerPassword(e.target.value)}
                        required
                        autoComplete="off"
                        placeholder={`Contraseña de ${selectedWorker.fullName.split(' ')[0]}`}
                        className="h-12 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] pr-4 pl-10 text-sm text-white placeholder-neutral-500 focus:border-[#FFD600] focus:outline-none"
                      />
                    </div>
                  </div>

                  {loginError && (
                    <div
                      role="alert"
                      className="rounded-xl border border-[#E31B23]/40 bg-[#E31B23]/15 px-4 py-2.5 text-sm text-red-200"
                    >
                      {loginError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loginLoading}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-5 text-sm font-extrabold text-[#111111] transition-colors hover:bg-[#f2ca00] disabled:opacity-50"
                  >
                    <span>{loginLoading ? 'Verificando...' : 'Ingresar al Sistema'}</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-[#262626] bg-[#141414] p-3.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FFD600]" />
            <p className="text-xs leading-relaxed text-neutral-400">
              <strong className="text-neutral-200">Control exclusivo del Administrador:</strong>{' '}
              Solo el Administrador puede registrar trabajadores y modificar sus contraseñas o la clave general del aplicativo.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
