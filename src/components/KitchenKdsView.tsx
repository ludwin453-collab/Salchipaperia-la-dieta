import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellRing, CheckCircle2, Flame, MapPin, UserCheck, UtensilsCrossed, Volume2, VolumeX } from 'lucide-react';
import type { Order, PosBootstrapState } from '../types/pos';
import {
  isSoundAlertEnabled,
  playKitchenOrderBell,
  setSoundAlertEnabled,
} from '../lib/audioAlert';

interface KitchenKdsViewProps {
  state: PosBootstrapState;
  onApiAction: (
    method: 'PATCH',
    url: string,
    body: unknown,
    description: string
  ) => Promise<unknown>;
}

const STATUS_STYLE: Record<
  Order['kitchenStatus'],
  { label: string; headerBg: string; headerText: string; border: string }
> = {
  NUEVO: {
    label: 'NUEVO PEDIDO',
    headerBg: 'bg-[#E31B23]',
    headerText: 'text-white',
    border: 'border-[#E31B23]',
  },
  EN_PREPARACION: {
    label: 'EN PREPARACIÓN',
    headerBg: 'bg-[#FFD600]',
    headerText: 'text-[#111111]',
    border: 'border-[#FFD600]',
  },
  LISTO: {
    label: 'LISTO PARA SERVIR',
    headerBg: 'bg-emerald-600',
    headerText: 'text-white',
    border: 'border-emerald-500',
  },
  ENTREGADO: {
    label: 'ENTREGADO',
    headerBg: 'bg-neutral-700',
    headerText: 'text-white',
    border: 'border-neutral-700',
  },
  ANULADO: {
    label: 'ANULADO',
    headerBg: 'bg-neutral-800',
    headerText: 'text-neutral-400',
    border: 'border-neutral-800',
  },
};

export function KitchenKdsView({ state, onApiAction }: KitchenKdsViewProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showDelivered, setShowDelivered] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => isSoundAlertEnabled());
  const [missingWaiterOrderId, setMissingWaiterOrderId] = useState<string | null>(null);
  const [missingDestOrderId, setMissingDestOrderId] = useState<string | null>(null);
  const [destDrafts, setDestDrafts] = useState<Record<string, string>>({});
  const knownNewIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const productDescMap = useMemo(
    () => new Map(state.products.map((p) => [p.id, p.description])),
    [state.products]
  );

  const newOrders = useMemo(
    () => state.orders.filter((o) => o.kitchenStatus === 'NUEVO'),
    [state.orders]
  );

  // Detectar nuevos pedidos que ingresan en estado NUEVO y disparar timbre
  useEffect(() => {
    const currentIds = new Set(newOrders.map((o) => o.id));
    if (knownNewIdsRef.current === null) {
      knownNewIdsRef.current = currentIds;
      if (currentIds.size > 0 && soundEnabled) {
        playKitchenOrderBell();
      }
      return;
    }
    const hasBrandNew = newOrders.some((o) => !knownNewIdsRef.current!.has(o.id));
    knownNewIdsRef.current = currentIds;
    if (hasBrandNew && soundEnabled) {
      playKitchenOrderBell();
    }
  }, [newOrders, soundEnabled]);

  // Recordatorio periódico cada 12s mientras existan pedidos NUEVO sin iniciar
  useEffect(() => {
    if (!soundEnabled || newOrders.length === 0) return;
    const timer = window.setInterval(() => {
      playKitchenOrderBell();
    }, 12000);
    return () => window.clearInterval(timer);
  }, [soundEnabled, newOrders.length]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setSoundAlertEnabled(next);
    if (next) {
      playKitchenOrderBell(true);
    }
  };

  const activeWaiters = useMemo(
    () => state.users.filter((u) => u.roleName === 'MOZO' && u.isActive),
    [state.users]
  );

  // FIFO: las comandas más antiguas primero
  const kitchenOrders = useMemo(() => {
    return state.orders
      .filter((o) => {
        if (o.kitchenStatus === 'ANULADO') return false;
        if (!showDelivered && o.kitchenStatus === 'ENTREGADO') return false;
        return true;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [state.orders, showDelivered]);

  const pendingCount = useMemo(
    () =>
      state.orders.filter(
        (o) => o.kitchenStatus === 'NUEVO' || o.kitchenStatus === 'EN_PREPARACION'
      ).length,
    [state.orders]
  );

  const formatElapsed = (iso: string) => {
    const diffSec = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
    const mins = Math.floor(diffSec / 60);
    const secs = diffSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const getOrderDestination = (order: Order) => {
    if (destDrafts[order.id] !== undefined) return destDrafts[order.id];
    if (order.deliveryDestination) return order.deliveryDestination;
    return order.tableLabel && order.tableLabel !== 'PARA LLEVAR'
      ? order.tableLabel
      : 'PARA LLEVAR - Mostrador';
  };

  const handleAssignWaiter = async (order: Order, deliveryWaiterId: string) => {
    setMissingWaiterOrderId((prev) => (prev === order.id ? null : prev));
    const waiter = activeWaiters.find((w) => w.id === deliveryWaiterId);
    const dest = getOrderDestination(order).trim();
    await onApiAction(
      'PATCH',
      `/api/orders/${order.id}/delivery-waiter`,
      {
        deliveryWaiterId: deliveryWaiterId || null,
        deliveryDestination: dest || null,
      },
      waiter ? `Mozo de entrega: ${waiter.fullName}` : 'Quitar mozo de entrega'
    );
  };

  const handleStatusChange = async (order: Order, nextStatus: 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO') => {
    const dest = getOrderDestination(order).trim();
    if (nextStatus === 'ENTREGADO') {
      if (activeWaiters.length > 0 && !order.deliveryWaiterId) {
        setMissingWaiterOrderId(order.id);
        return;
      }
      if (!dest) {
        setMissingDestOrderId(order.id);
        return;
      }
    }
    setMissingWaiterOrderId(null);
    setMissingDestOrderId(null);
    await onApiAction(
      'PATCH',
      `/api/orders/${order.id}/status`,
      {
        status: nextStatus,
        deliveryWaiterId: order.deliveryWaiterId,
        deliveryDestination: dest || null,
      },
      `Estado cocina ${nextStatus}`
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Barra superior especial para tablet cocina horizontal */}
      <div className="flex flex-col gap-4 rounded-2xl border border-[#2A2A2A] bg-[#161616] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-extrabold text-white">
            Monitor de Cocina (KDS)
          </h2>
          <p className="text-sm text-neutral-400">
            Orden FIFO automático. Designa qué mozo entregará el pedido y a dónde debe enviarlo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={toggleSound}
            className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-extrabold transition-colors ${
              soundEnabled
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-neutral-700 bg-[#1E1E1E] text-neutral-400'
            }`}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4 text-emerald-400" /> : <VolumeX className="h-4 w-4" />}
            <span>{soundEnabled ? 'Timbre Activo' : 'Timbre Silenciado'}</span>
          </button>

          <button
            type="button"
            onClick={() => playKitchenOrderBell(true)}
            className="flex min-h-[44px] items-center gap-2 rounded-xl border border-[#2E2E2E] bg-[#1E1E1E] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#2A2A2A]"
          >
            <BellRing className="h-4 w-4 text-[#FFD600]" />
            <span>Probar Timbre</span>
          </button>

          <button
            type="button"
            onClick={() => setShowDelivered((v) => !v)}
            className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              showDelivered
                ? 'bg-[#FFD600] text-[#111111]'
                : 'border border-[#2E2E2E] bg-[#1E1E1E] text-neutral-300'
            }`}
          >
            {showDelivered ? 'Ocultar Entregados' : 'Ver Entregados'}
          </button>

          <div
            className={`flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 font-mono text-sm font-extrabold tabular-nums ${
              pendingCount > 0 ? 'bg-[#E31B23] text-white' : 'bg-emerald-600 text-white'
            }`}
          >
            <Bell className="h-4 w-4" />
            <span>{pendingCount} PENDIENTES</span>
          </div>
        </div>
      </div>

      {/* Banner de timbre visual cuando hay pedidos NUEVOS por iniciar */}
      {newOrders.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-[#E31B23] bg-[#2D1013] px-4 py-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E31B23] text-white animate-pulse">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-sm font-extrabold text-[#FFD600] sm:text-base">
                ¡TIMBRE DE COCINA! Tienes {newOrders.length} pedido(s) nuevo(s) por preparar
              </p>
              <p className="text-xs text-red-100">
                {newOrders.map((o) => `${o.tableLabel} (${o.orderCode})`).join(' · ')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => playKitchenOrderBell(true)}
            className="min-h-[38px] rounded-xl bg-[#FFD600] px-3.5 text-xs font-extrabold text-[#111111] hover:bg-[#ffe142]"
          >
            Sonar Timbre
          </button>
        </div>
      )}

      {/* Cuadrícula horizontal de comandas */}
      {kitchenOrders.length === 0 ? (
        <div className="flex min-h-[340px] flex-col items-center justify-center rounded-2xl border border-[#262626] bg-[#161616] p-10 text-center">
          <UtensilsCrossed className="mb-3 h-12 w-12 text-neutral-600" />
          <p className="font-display text-xl font-bold text-white">Sin comandas pendientes en cocina</p>
          <p className="mt-1 text-sm text-neutral-400">
            Los nuevos pedidos registrados por los mozos aparecerán aquí al instante con alerta sonora.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {kitchenOrders.map((order) => {
            const st = STATUS_STYLE[order.kitchenStatus];
            const entryTime = new Date(order.createdAt).toLocaleTimeString('es-PE', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const needsWaiterHighlight = missingWaiterOrderId === order.id;
            const needsDestHighlight = missingDestOrderId === order.id;
            const currentDest = getOrderDestination(order);

            return (
              <article
                key={order.id}
                className={`flex flex-col justify-between overflow-hidden rounded-2xl border-2 bg-[#181818] ${st.border}`}
              >
                <div>
                  {/* Cabecera de comanda */}
                  <div className={`flex items-center justify-between px-4 py-3 ${st.headerBg} ${st.headerText}`}>
                    <div>
                      <p className="font-display text-lg font-extrabold leading-none">
                        {order.tableLabel}
                      </p>
                      <p className="mt-1 font-mono text-xs font-bold opacity-90">
                        {order.orderCode} · {st.label}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-2xl font-extrabold leading-none tabular-nums">
                        {formatElapsed(order.createdAt)}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold opacity-90">Ingreso {entryTime}</p>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="border-b border-[#262626] bg-[#141414] px-4 py-2.5 text-xs text-neutral-300 flex flex-wrap justify-between gap-2">
                    <span>
                      Cliente: <strong className="text-white">{order.customerName}</strong>
                    </span>
                    <span>
                      Tomó: <strong className="text-white">{order.waiterName}</strong>
                    </span>
                  </div>

                  {/* Ítems compactos y legibles (nombre + ingredientes + observaciones) */}
                  <ul className="divide-y divide-[#242424] px-4 py-1.5">
                    {order.items.map((item) => {
                      const ingText = productDescMap.get(item.productId);
                      return (
                        <li key={item.id} className="py-2">
                          <div className="flex items-start gap-2.5">
                            <span className="flex h-7 min-w-[32px] items-center justify-center rounded-lg bg-[#252525] font-mono text-sm font-extrabold text-[#FFD600] tabular-nums">
                              {item.quantity}x
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="font-display text-base font-bold text-white leading-snug">
                                {item.productNameSnapshot}
                              </p>
                              {ingText && (
                                <p className="text-xs text-neutral-400 leading-snug">{ingText}</p>
                              )}
                              {item.notes && (
                                <p className="mt-1 rounded-lg border border-[#E31B23]/40 bg-[#E31B23]/15 px-2.5 py-1 text-xs font-bold text-[#FFD600]">
                                  Obs: {item.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Designación de mozo + destino de envío + botón de acción */}
                <div className="border-t border-[#262626] bg-[#141414] p-3.5 space-y-2.5">
                  {order.kitchenStatus !== 'ENTREGADO' && (
                    <>
                      <div>
                        <label className="mb-1 flex items-center gap-1.5 text-xs font-bold text-neutral-300">
                          <UserCheck className="h-3.5 w-3.5 text-[#FFD600]" />
                          <span>Mozo que entrega el pedido:</span>
                        </label>
                        <select
                          value={order.deliveryWaiterId ?? ''}
                          onChange={(e) => void handleAssignWaiter(order, e.target.value)}
                          className={`h-11 w-full rounded-xl border bg-[#111111] px-3 text-xs font-bold text-white focus:outline-none ${
                            needsWaiterHighlight
                              ? 'border-[#E31B23] ring-2 ring-[#E31B23]/60'
                              : order.deliveryWaiterId
                                ? 'border-emerald-500/60'
                                : 'border-[#2E2E2E] focus:border-[#FFD600]'
                          }`}
                        >
                          <option value="">Designar mozo para entrega...</option>
                          {activeWaiters.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.fullName} (@{w.username})
                            </option>
                          ))}
                        </select>
                        {needsWaiterHighlight && (
                          <p className="mt-1 text-xs font-bold text-red-400">
                            Selecciona qué mozo entregará el pedido antes de confirmar la entrega.
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 flex items-center gap-1.5 text-xs font-bold text-neutral-300">
                          <MapPin className="h-3.5 w-3.5 text-[#FFD600]" />
                          <span>Indicar a dónde enviar el pedido:</span>
                        </label>
                        <input
                          type="text"
                          value={currentDest}
                          onChange={(e) => {
                            const val = e.target.value;
                            setMissingDestOrderId((prev) => (prev === order.id ? null : prev));
                            setDestDrafts((prev) => ({ ...prev, [order.id]: val }));
                          }}
                          placeholder="Ej: Mesa 03, Mostrador Para Llevar o Dirección"
                          className={`h-11 w-full rounded-xl border bg-[#111111] px-3 text-xs font-bold text-white placeholder-neutral-500 focus:outline-none ${
                            needsDestHighlight
                              ? 'border-[#E31B23] ring-2 ring-[#E31B23]/60'
                              : 'border-[#2E2E2E] focus:border-[#FFD600]'
                          }`}
                        />
                        {needsDestHighlight && (
                          <p className="mt-1 text-xs font-bold text-red-400">
                            Indica el destino (mesa, mostrador o dirección) a donde debe llevarse el pedido.
                          </p>
                        )}
                      </div>
                    </>
                  )}

                  {order.kitchenStatus === 'NUEVO' && (
                    <button
                      type="button"
                      onClick={() => void handleStatusChange(order, 'EN_PREPARACION')}
                      className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-4 py-3 text-sm font-extrabold text-[#111111] hover:bg-[#f2ca00]"
                    >
                      <Flame className="h-5 w-5" />
                      <span>INICIAR PREPARACIÓN</span>
                    </button>
                  )}

                  {order.kitchenStatus === 'EN_PREPARACION' && (
                    <button
                      type="button"
                      onClick={() => void handleStatusChange(order, 'LISTO')}
                      className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-emerald-500"
                    >
                      <CheckCircle2 className="h-5 w-5" />
                      <span>MARCAR LISTO</span>
                    </button>
                  )}

                  {order.kitchenStatus === 'LISTO' && (
                    <button
                      type="button"
                      onClick={() => void handleStatusChange(order, 'ENTREGADO')}
                      className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-sky-500"
                    >
                      <UtensilsCrossed className="h-5 w-5" />
                      <span>
                        {order.deliveryWaiterName
                          ? `ENTREGAR A ${order.deliveryWaiterName.split(' ')[0].toUpperCase()} → ${currentDest}`
                          : `REGISTRAR ENTREGA → ${currentDest}`}
                      </span>
                    </button>
                  )}

                  {order.kitchenStatus === 'ENTREGADO' && (
                    <div className="rounded-xl border border-[#262626] bg-[#111111] px-3 py-2 text-center text-xs space-y-1">
                      <p className="font-bold text-neutral-300">
                        Mozo: <span className="text-[#FFD600]">{order.deliveryWaiterName ?? order.waiterName}</span>
                        {order.deliveredAt ? ` · ${new Date(order.deliveredAt).toLocaleTimeString('es-PE')}` : ''}
                      </p>
                      <p className="font-bold text-sky-300">
                        Enviar a: {order.deliveryDestination || order.tableLabel}
                      </p>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
