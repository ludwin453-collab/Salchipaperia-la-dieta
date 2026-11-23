import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingBag,
  Utensils,
  Plus,
  Minus,
  Send,
  Clock,
  CheckCircle2,
  ArrowLeftRight,
  Sparkles,
  MessageSquare,
  X,
  UserPlus,
  Trash2,
  MapPin,
  CalendarClock,
  BellRing,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  Account,
  DiningTable,
  Order,
  PosBootstrapState,
  Product,
  User,
} from '../types/pos';
import {
  isSoundAlertEnabled,
  playWaiterReadyBell,
  setSoundAlertEnabled,
} from '../lib/audioAlert';
import { ReservationManagerPanel } from './ReservationManagerPanel';

interface WaiterViewProps {
  state: PosBootstrapState;
  currentUser: User;
  onApiAction: (
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body: unknown,
    description: string,
    queueIfOffline?: boolean
  ) => Promise<unknown>;
}

interface CartItem {
  product: Product;
  quantity: number;
  notes: string;
  accountGuestId: string | null;
}

const TABLE_STATUS_META: Record<
  DiningTable['status'],
  { label: string; border: string; bg: string; text: string }
> = {
  LIBRE: {
    label: 'Disponible',
    border: 'border-emerald-500/50',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
  },
  OCUPADA: {
    label: 'Ocupada',
    border: 'border-[#E31B23]/70',
    bg: 'bg-[#E31B23]/12',
    text: 'text-red-400',
  },
  PENDIENTE_PAGO: {
    label: 'Pendiente de pago',
    border: 'border-amber-400/70',
    bg: 'bg-amber-500/12',
    text: 'text-amber-300',
  },
  EN_LIMPIEZA: {
    label: 'En limpieza',
    border: 'border-sky-400/70',
    bg: 'bg-sky-500/12',
    text: 'text-sky-300',
  },
};

export function WaiterView({
  state,
  currentUser,
  onApiAction,
}: WaiterViewProps) {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [isOrderDrawerOpen, setIsOrderDrawerOpen] = useState(false);
  const [isTakeawayMode, setIsTakeawayMode] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryDestination, setDeliveryDestination] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    state.categories.find((c) => c.isActive)?.id ?? ''
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editingNoteIdx, setEditingNoteIdx] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [transferTargetId, setTransferTargetId] = useState('');
  const [confirmReleaseTableId, setConfirmReleaseTableId] = useState<string | null>(null);
  const [reserveTableId, setReserveTableId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'MESAS' | 'COMANDAS' | 'RESERVAS' | 'CLIENTES'>('MESAS');
  const [showAddWaiterModal, setShowAddWaiterModal] = useState(false);
  const [waiterFullName, setWaiterFullName] = useState('');
  const [waiterUsername, setWaiterUsername] = useState('');
  const [waiterPassword, setWaiterPassword] = useState('1111');
  const [confirmDeleteWaiterId, setConfirmDeleteWaiterId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => isSoundAlertEnabled());
  const knownAlertIdsRef = useRef<Set<string> | null>(null);

  const activeCategories = useMemo(
    () => state.categories.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [state.categories]
  );

  const recipeIngredientsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of state.recipes) {
      if (r.items.length > 0) {
        map.set(
          r.productId,
          r.items.map((it) => it.ingredientName).join(', ')
        );
      }
    }
    return map;
  }, [state.recipes]);

  const accountMap = useMemo(
    () => new Map(state.accounts.map((a) => [a.id, a])),
    [state.accounts]
  );

  const tableStats = useMemo(() => {
    const libres = state.tables.filter((t) => t.status === 'LIBRE').length;
    const ocupadas = state.tables.filter((t) => t.status === 'OCUPADA').length;
    const pendientes = state.tables.filter((t) => t.status === 'PENDIENTE_PAGO').length;
    const activas = state.orders.filter(
      (o) => o.kitchenStatus !== 'ENTREGADO' && o.kitchenStatus !== 'ANULADO'
    ).length;
    return { libres, ocupadas, pendientes, activas };
  }, [state.tables, state.orders]);

  const selectedTable = useMemo(
    () => state.tables.find((t) => t.id === selectedTableId) ?? null,
    [state.tables, selectedTableId]
  );

  const activeTableAccount: Account | null = useMemo(() => {
    if (!selectedTable?.activeAccountId) return null;
    return accountMap.get(selectedTable.activeAccountId) ?? null;
  }, [selectedTable, accountMap]);

  const activeTableOrders: Order[] = useMemo(() => {
    if (!activeTableAccount) return [];
    return state.orders.filter((o) => o.accountId === activeTableAccount.id && o.kitchenStatus !== 'ANULADO');
  }, [activeTableAccount, state.orders]);

  const openOrderModal = (table: DiningTable | null, takeaway: boolean) => {
    setSelectedTableId(table?.id ?? null);
    setConfirmReleaseTableId(null);
    setIsTakeawayMode(takeaway);
    if (table?.activeAccountId) {
      const acc = accountMap.get(table.activeAccountId);
      setCustomerName(acc?.mainCustomerName ?? '');
    } else {
      setCustomerName('');
    }
    setCustomerPhone('');
    setDeliveryDestination(takeaway ? '' : table?.label ?? '');
    setCart([]);
    if (!selectedCategoryId && activeCategories.length > 0) {
      setSelectedCategoryId(activeCategories[0].id);
    }
    setIsOrderDrawerOpen(true);
  };

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.product.id === product.id && item.notes === '');
      if (idx >= 0) {
        return prev.map((item, i) => (i === idx ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...prev, { product, quantity: 1, notes: '', accountGuestId: null }];
    });
  };

  const updateCartQty = (idx: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item, i) => (i === idx ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
    [cart]
  );

  const handleConfirmOrder = async () => {
    if (cart.length === 0) return;
    setSubmitting(true);
    const now = new Date();
    const orderId = crypto.randomUUID();
    const orderCode = `LD-${now.getHours().toString().padStart(2, '0')}${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}-${orderId.slice(0, 4).toUpperCase()}`;

    const payload = {
      id: orderId,
      orderCode,
      accountId: isTakeawayMode ? null : activeTableAccount?.id ?? null,
      tableId: isTakeawayMode ? null : selectedTable?.id ?? null,
      isTakeaway: isTakeawayMode,
      deliveryDestination: isTakeawayMode
        ? deliveryDestination.trim() || 'PARA LLEVAR - Mostrador'
        : selectedTable?.label ?? null,
      customerName: customerName.trim() || (isTakeawayMode ? 'Cliente Para Llevar' : 'Cliente General'),
      customerPhone: customerPhone.trim() || null,
      waiterId: currentUser.id,
      items: cart.map((c) => ({
        id: crypto.randomUUID(),
        productId: c.product.id,
        productName: c.product.name,
        unitPrice: c.product.price,
        quantity: c.quantity,
        notes: c.notes,
        accountGuestId: c.accountGuestId,
      })),
    };

    const ok = await onApiAction(
      'POST',
      '/api/orders',
      payload,
      `Comanda ${orderCode} (${isTakeawayMode ? 'Para llevar' : selectedTable?.label ?? ''})`,
      true
    );
    setSubmitting(false);
    if (ok) {
      setIsOrderDrawerOpen(false);
      setCart([]);
    }
  };

  const handleReleaseTable = async (tableId: string, forceRelease = false) => {
    const ok = await onApiAction(
      'PATCH',
      `/api/tables/${tableId}/status`,
      { status: 'LIBRE', forceRelease },
      'Liberar mesa'
    );
    if (ok) {
      setConfirmReleaseTableId(null);
      setSelectedTableId(null);
    }
  };

  const handleConfirmDeliveryAtDestination = async (orderId: string) => {
    await onApiAction(
      'PATCH',
      `/api/orders/${orderId}/confirm-delivery`,
      {},
      'Entrega confirmada en destino'
    );
  };

  const handleTransferTable = async () => {
    if (!selectedTable || !transferTargetId) return;
    const ok = await onApiAction(
      'POST',
      `/api/tables/${selectedTable.id}/transfer`,
      { toTableId: transferTargetId },
      `Traslado de ${selectedTable.label}`
    );
    if (ok) {
      setSelectedTableId(null);
      setTransferTargetId('');
    }
  };

  const filteredProducts = useMemo(() => {
    const catId = selectedCategoryId || activeCategories[0]?.id;
    return state.products.filter((p) => p.categoryId === catId);
  }, [state.products, selectedCategoryId, activeCategories]);

  const activeOrdersList = useMemo(
    () =>
      state.orders
        .filter((o) => o.kitchenStatus !== 'ANULADO')
        .slice()
        .reverse(),
    [state.orders]
  );

  const readyInKitchenOrders = useMemo(
    () =>
      state.orders
        .filter((o) => o.kitchenStatus === 'LISTO')
        .slice()
        .sort((a, b) => {
          const aMine = a.deliveryWaiterId === currentUser.id || a.waiterId === currentUser.id ? 0 : 1;
          const bMine = b.deliveryWaiterId === currentUser.id || b.waiterId === currentUser.id ? 0 : 1;
          if (aMine !== bMine) return aMine - bMine;
          return new Date(a.readyAt ?? a.createdAt).getTime() - new Date(b.readyAt ?? b.createdAt).getTime();
        }),
    [state.orders, currentUser.id]
  );

  const pendingDispatchOrders = useMemo(
    () =>
      state.orders
        .filter((o) => o.kitchenStatus === 'ENTREGADO' && !o.waiterConfirmedAt)
        .slice()
        .sort((a, b) => {
          const aMine = a.deliveryWaiterId === currentUser.id ? 0 : 1;
          const bMine = b.deliveryWaiterId === currentUser.id ? 0 : 1;
          if (aMine !== bMine) return aMine - bMine;
          return new Date(b.deliveredAt ?? b.createdAt).getTime() - new Date(a.deliveredAt ?? a.createdAt).getTime();
        }),
    [state.orders, currentUser.id]
  );

  const myAlertOrders = useMemo(() => {
    const combined = [...readyInKitchenOrders, ...pendingDispatchOrders];
    if (currentUser.roleName === 'MOZO') {
      return combined.filter((o) => !o.deliveryWaiterId || o.deliveryWaiterId === currentUser.id);
    }
    return combined;
  }, [readyInKitchenOrders, pendingDispatchOrders, currentUser.roleName, currentUser.id]);

  // Disparar timbre cuando aparece un plato LISTO o ENTREGADO pendiente de llevar
  useEffect(() => {
    const currentIds = new Set(myAlertOrders.map((o) => `${o.id}:${o.kitchenStatus}:${o.deliveryWaiterId ?? ''}`));
    if (knownAlertIdsRef.current === null) {
      knownAlertIdsRef.current = currentIds;
      if (currentIds.size > 0 && soundEnabled) {
        playWaiterReadyBell();
      }
      return;
    }
    const hasNewReady = myAlertOrders.some(
      (o) => !knownAlertIdsRef.current!.has(`${o.id}:${o.kitchenStatus}:${o.deliveryWaiterId ?? ''}`)
    );
    knownAlertIdsRef.current = currentIds;
    if (hasNewReady && soundEnabled) {
      playWaiterReadyBell();
    }
  }, [myAlertOrders, soundEnabled]);

  // Recordatorio periódico cada 14s mientras haya platos listos o por confirmar entrega
  useEffect(() => {
    if (!soundEnabled || myAlertOrders.length === 0) return;
    const timer = window.setInterval(() => {
      playWaiterReadyBell();
    }, 14000);
    return () => window.clearInterval(timer);
  }, [soundEnabled, myAlertOrders.length]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setSoundAlertEnabled(next);
    if (next) {
      playWaiterReadyBell(true);
    }
  };

  const activeReservations = useMemo(
    () =>
      state.reservations.filter(
        (r) => r.status === 'PENDIENTE' || r.status === 'EN_PREPARACION'
      ),
    [state.reservations]
  );

  const reservationByTableId = useMemo(() => {
    const map = new Map<string, (typeof activeReservations)[number]>();
    for (const r of activeReservations) {
      if (r.tableId && !map.has(r.tableId)) {
        map.set(r.tableId, r);
      }
    }
    return map;
  }, [activeReservations]);

  return (
    <div className="space-y-6 pb-16">
      {/* Encabezado operativo de Mozos y acción rápida Para Llevar */}
      <div className="flex flex-col gap-4 border-b border-[#262626] pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-2xl font-extrabold text-white">Salón y Toma de Pedidos</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-neutral-400">
            <span>Mozo: <strong className="text-white">{currentUser.fullName}</strong></span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">Disponibles: <strong className="text-emerald-400">{tableStats.libres}</strong></span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">Ocupadas: <strong className="text-red-400">{tableStats.ocupadas}</strong></span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">Por cobrar: <strong className="text-amber-300">{tableStats.pendientes}</strong></span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">En cocina: <strong className="text-[#FFD600]">{tableStats.activas}</strong></span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleSound}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-extrabold transition-colors whitespace-nowrap shrink-0 ${
              soundEnabled
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                : 'border-[#2E2E2E] bg-[#1A1A1A] text-neutral-400'
            }`}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4 text-emerald-400" /> : <VolumeX className="h-4 w-4" />}
            <span>{soundEnabled ? 'Timbre Activo' : 'Silenciado'}</span>
          </button>
          <button
            type="button"
            onClick={() => playWaiterReadyBell(true)}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#2E2E2E] bg-[#1A1A1A] px-3 py-2 text-xs font-bold text-white hover:border-[#FFD600] whitespace-nowrap shrink-0"
          >
            <BellRing className="h-4 w-4 text-[#FFD600]" />
            <span className="hidden sm:inline">Probar Timbre</span>
          </button>
          {currentUser.roleName === 'ADMINISTRADOR' && (
            <button
              type="button"
              onClick={() => setShowAddWaiterModal(true)}
              className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#2E2E2E] bg-[#1A1A1A] px-3.5 py-2.5 text-xs font-bold text-[#FFD600] transition-colors hover:border-[#FFD600] whitespace-nowrap shrink-0 sm:text-sm"
            >
              <UserPlus className="h-4 w-4" />
              <span>Gestionar Mozos</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => openOrderModal(null, true)}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#E31B23] px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-[#c8161d] whitespace-nowrap shrink-0 sm:text-sm"
          >
            <ShoppingBag className="h-4 w-4 sm:h-5 sm:w-5" />
            <span>Nuevo Pedido Para Llevar</span>
          </button>
        </div>
      </div>

      {/* Timbre visual: Platos LISTOS en Cocina para que el Mozo pase a recoger y llevar */}
      {readyInKitchenOrders.length > 0 && (
        <section className="rounded-2xl border-2 border-[#FFD600] bg-[#241F0E] p-4 space-y-3 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-extrabold text-[#FFD600] flex items-center gap-2 sm:text-base">
              <BellRing className="h-5 w-5 animate-pulse text-[#FFD600]" />
              <span>¡TIMBRE! Platos Listos en Cocina para Llevar ({readyInKitchenOrders.length})</span>
            </h3>
            <button
              type="button"
              onClick={() => playWaiterReadyBell(true)}
              className="min-h-[34px] rounded-lg bg-[#FFD600] px-3 text-xs font-extrabold text-[#111111]"
            >
              Sonar Timbre
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {readyInKitchenOrders.map((ord) => {
              const isMine = ord.deliveryWaiterId === currentUser.id;
              const destination = ord.deliveryDestination || ord.tableLabel || 'Mostrador';
              return (
                <div
                  key={ord.id}
                  className={`rounded-xl border p-3 space-y-1.5 ${
                    isMine
                      ? 'border-emerald-400 bg-[#122219]'
                      : 'border-[#FFD600]/40 bg-[#161616]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono font-bold text-white">{ord.orderCode}</span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
                        isMine
                          ? 'bg-emerald-500 text-[#111111]'
                          : ord.deliveryWaiterName
                            ? 'bg-amber-500/20 text-[#FFD600]'
                            : 'bg-[#FFD600] text-[#111111]'
                      }`}
                    >
                      {isMine
                        ? '¡TE TOCA LLEVAR!'
                        : ord.deliveryWaiterName
                          ? `Para: ${ord.deliveryWaiterName}`
                          : 'LISTO EN BARRA'}
                    </span>
                  </div>
                  <p className="font-display text-sm font-extrabold text-[#FFD600]">
                    Llevar a: {destination} · {ord.customerName}
                  </p>
                  <p className="text-xs text-neutral-200 line-clamp-2">
                    {ord.items.map((it) => `${it.quantity}x ${it.productNameSnapshot}`).join(' · ')}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Pedidos entregados por Cocina con indicación exacta de envío */}
      {pendingDispatchOrders.length > 0 && (
        <section className="rounded-2xl border border-sky-500/50 bg-sky-950/20 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-extrabold text-sky-300 flex items-center gap-2 sm:text-base">
              <MapPin className="h-4 w-4 text-[#FFD600]" />
              <span>Entregas de Cocina — A Dónde Enviar ({pendingDispatchOrders.length})</span>
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {pendingDispatchOrders.map((ord) => {
              const isMine = ord.deliveryWaiterId === currentUser.id;
              const destination = ord.deliveryDestination || ord.tableLabel || 'Mostrador';
              return (
                <div
                  key={ord.id}
                  className={`flex flex-col justify-between gap-2.5 rounded-xl border p-3.5 ${
                    isMine
                      ? 'border-[#FFD600] bg-[#1D1B12]'
                      : 'border-[#2E2E2E] bg-[#161616]'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-bold text-neutral-300">{ord.orderCode}</span>
                      {ord.deliveryWaiterName && (
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
                            isMine ? 'bg-[#FFD600] text-[#111111]' : 'bg-sky-600/30 text-sky-200'
                          }`}
                        >
                          {isMine ? 'Asignado a ti' : ord.deliveryWaiterName}
                        </span>
                      )}
                    </div>
                    <div className="rounded-lg border border-sky-500/40 bg-[#111111] px-3 py-2">
                      <p className="text-[10px] font-bold text-sky-300 uppercase">Enviar pedido a:</p>
                      <p className="font-display text-base font-extrabold text-[#FFD600] leading-tight">
                        {destination}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-300">Cliente: {ord.customerName}</p>
                    </div>
                    <p className="text-xs text-neutral-300 line-clamp-2">
                      {ord.items.map((it) => `${it.quantity}x ${it.productNameSnapshot}`).join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleConfirmDeliveryAtDestination(ord.id)}
                    className="flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-extrabold text-white hover:bg-emerald-500"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Confirmar Entrega en Destino</span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Navegación interna del módulo Mozo */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#262626] pb-3">
        {[
          { id: 'MESAS', label: 'Mesas del Salón' },
          { id: 'COMANDAS', label: `Comandas y Cocina (${activeOrdersList.length})` },
          { id: 'RESERVAS', label: `Reservas (${activeReservations.length})` },
          { id: 'CLIENTES', label: `Clientes (${state.customers.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`min-h-[42px] rounded-xl px-4 py-2 text-sm font-bold transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[#FFD600] text-[#111111]'
                : 'bg-[#1A1A1A] text-neutral-300 hover:bg-[#242424]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: MESAS */}
      {activeTab === 'MESAS' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="grid grid-cols-3 gap-2 self-start sm:grid-cols-4 sm:gap-2.5 md:grid-cols-5 lg:col-span-8 xl:grid-cols-6">
            {state.tables.map((table) => {
              const meta = TABLE_STATUS_META[table.status];
              const acc = table.activeAccountId ? accountMap.get(table.activeAccountId) : null;
              const tblRes = reservationByTableId.get(table.id);
              const isSelected = selectedTable?.id === table.id;
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => {
                    setSelectedTableId(table.id);
                    setConfirmReleaseTableId(null);
                  }}
                  className={`flex min-h-[76px] flex-col justify-between rounded-xl border p-2 text-left transition-all sm:min-h-[84px] sm:p-2.5 ${meta.border} ${meta.bg} ${
                    isSelected ? 'ring-2 ring-[#FFD600]' : 'hover:brightness-110'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-display text-xs font-extrabold text-white leading-none sm:text-sm">
                      {table.label}
                    </span>
                    <Utensils className={`h-3.5 w-3.5 shrink-0 ${meta.text}`} />
                  </div>
                  <div className="mt-1">
                    {acc ? (
                      <div className="space-y-0.5 leading-tight">
                        <p className="truncate text-[11px] font-medium text-neutral-200">{acc.mainCustomerName}</p>
                        <p className="font-mono text-xs font-extrabold text-[#FFD600] tabular-nums">
                          S/ {(acc.totalAmount - acc.paidAmount).toFixed(2)}
                        </p>
                      </div>
                    ) : (
                      <p className={`text-[11px] font-bold leading-tight ${meta.text}`}>{meta.label}</p>
                    )}
                    {tblRes && (
                      <p className="mt-0.5 truncate text-[10px] font-bold text-[#FFD600]">
                        Res. {tblRes.startTime}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Panel lateral de Mesa Seleccionada */}
          <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 lg:col-span-4">
            {!selectedTable ? (
              <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center text-neutral-400">
                <Utensils className="mb-3 h-10 w-10 text-neutral-600" />
                <p className="text-sm font-semibold text-white">Selecciona una mesa</p>
                <p className="mt-1 text-xs text-neutral-400">
                  Podrás tomar un nuevo pedido, agregar productos adicionales o revisar su cuenta.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-2 border-b border-[#2A2A2A] pb-3">
                  <div>
                    <h3 className="font-display text-xl font-extrabold text-white">{selectedTable.label}</h3>
                    <p className={`text-xs font-bold ${TABLE_STATUS_META[selectedTable.status].text}`}>
                      Estado: {TABLE_STATUS_META[selectedTable.status].label}
                    </p>
                  </div>
                  {selectedTable.status !== 'LIBRE' && (
                    <button
                      type="button"
                      onClick={() => {
                        const pending = activeTableAccount
                          ? activeTableAccount.totalAmount - activeTableAccount.paidAmount
                          : 0;
                        if (activeTableAccount && pending > 0.01) {
                          setConfirmReleaseTableId(selectedTable.id);
                        } else {
                          void handleReleaseTable(selectedTable.id, false);
                        }
                      }}
                      className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 shrink-0"
                    >
                      <Sparkles className="h-4 w-4" />
                      <span>Liberar Mesa</span>
                    </button>
                  )}
                </div>

                {confirmReleaseTableId === selectedTable.id && activeTableAccount && (
                  <div className="rounded-xl border border-amber-400/60 bg-amber-500/10 p-3 text-xs space-y-2.5">
                    <p className="font-bold text-amber-200">
                      {selectedTable.label} aún tiene S/{' '}
                      {(activeTableAccount.totalAmount - activeTableAccount.paidAmount).toFixed(2)} pendiente. Si la liberas ahora, la cuenta pasará a Caja para su cobro y la mesa quedará Disponible.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleReleaseTable(selectedTable.id, true)}
                        className="flex-1 min-h-[38px] rounded-lg bg-emerald-600 px-3 font-extrabold text-white hover:bg-emerald-500"
                      >
                        Confirmar Liberar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmReleaseTableId(null)}
                        className="min-h-[38px] rounded-lg bg-[#262626] px-3 font-bold text-neutral-300"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}

                {activeTableAccount ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-3.5 text-sm space-y-1">
                      <p className="text-neutral-400">
                        Cliente: <strong className="text-white">{activeTableAccount.mainCustomerName}</strong>
                      </p>
                      <p className="text-neutral-400">
                        Mozo: <strong className="text-white">{activeTableAccount.waiterName}</strong>
                      </p>
                      <div className="mt-2 flex items-center justify-between border-t border-[#262626] pt-2">
                        <span className="text-neutral-400">Consumo total</span>
                        <span className="font-mono text-lg font-bold text-[#FFD600] tabular-nums">
                          S/ {activeTableAccount.totalAmount.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-neutral-400">Saldo pendiente</span>
                        <span className="font-mono font-bold text-white tabular-nums">
                          S/ {(activeTableAccount.totalAmount - activeTableAccount.paidAmount).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openOrderModal(selectedTable, false)}
                      className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-4 py-3 text-sm font-bold text-[#111111] hover:bg-[#f2ca00]"
                    >
                      <Plus className="h-5 w-5" />
                      <span>Agregar Productos Adicionales</span>
                    </button>

                    {/* Traslado de mesa */}
                    <div className="rounded-xl border border-[#2A2A2A] bg-[#141414] p-3">
                      <p className="mb-2 text-xs font-semibold text-neutral-300">Trasladar cuenta a otra mesa libre</p>
                      <div className="flex gap-2">
                        <select
                          value={transferTargetId}
                          onChange={(e) => setTransferTargetId(e.target.value)}
                          className="h-10 flex-1 rounded-lg border border-[#2E2E2E] bg-[#111111] px-2.5 text-xs text-white"
                        >
                          <option value="">Elegir mesa libre...</option>
                          {state.tables
                            .filter((t) => t.status === 'LIBRE')
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.label}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          disabled={!transferTargetId}
                          onClick={handleTransferTable}
                          className="flex h-10 items-center gap-1 rounded-lg bg-[#262626] px-3 text-xs font-bold text-white hover:bg-[#333333] disabled:opacity-40"
                        >
                          <ArrowLeftRight className="h-3.5 w-3.5" />
                          <span>Trasladar</span>
                        </button>
                      </div>
                    </div>

                    {/* Comandas de esta mesa */}
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-neutral-400">Comandas enviadas ({activeTableOrders.length})</p>
                      <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                        {activeTableOrders.map((ord) => (
                          <div key={ord.id} className="rounded-xl border border-[#262626] bg-[#121212] p-3 text-xs">
                            <div className="flex items-center justify-between font-bold">
                              <span className="font-mono text-white">{ord.orderCode}</span>
                              <span
                                className={
                                  ord.kitchenStatus === 'LISTO'
                                    ? 'text-emerald-400'
                                    : ord.kitchenStatus === 'EN_PREPARACION'
                                      ? 'text-[#FFD600]'
                                      : ord.kitchenStatus === 'NUEVO'
                                        ? 'text-red-400'
                                        : 'text-neutral-400'
                                }
                              >
                                {ord.kitchenStatus.replace('_', ' ')}
                              </span>
                            </div>
                            <ul className="mt-1.5 space-y-1 text-neutral-300">
                              {ord.items.map((it) => (
                                <li key={it.id} className="flex justify-between">
                                  <span>
                                    {it.quantity}x {it.productNameSnapshot}
                                    {it.notes ? ` (${it.notes})` : ''}
                                  </span>
                                  <span className="font-mono tabular-nums">
                                    S/ {(it.quantity * it.unitPriceSnapshot).toFixed(2)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                            {(ord.deliveryWaiterName || ord.deliveryDestination) && (
                              <p className="mt-1.5 text-[11px] font-bold text-sky-300">
                                {ord.deliveryWaiterName ? `Entrega: ${ord.deliveryWaiterName}` : ''}
                                {ord.deliveryWaiterName && ord.deliveryDestination ? ' → ' : ''}
                                {ord.deliveryDestination ? `Enviar a: ${ord.deliveryDestination}` : ''}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-neutral-400">
                      Esta mesa está libre. Registra el nombre del cliente y toma su pedido inicial.
                    </p>
                    <button
                      type="button"
                      disabled={selectedTable.status === 'EN_LIMPIEZA'}
                      onClick={() => openOrderModal(selectedTable, false)}
                      className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-4 py-3 text-sm font-bold text-[#111111] hover:bg-[#f2ca00] disabled:opacity-40"
                    >
                      <Plus className="h-5 w-5" />
                      <span>Abrir Mesa y Tomar Pedido</span>
                    </button>
                  </div>
                )}

                {reservationByTableId.get(selectedTable.id) && (
                  <div className="rounded-xl border border-[#FFD600]/40 bg-[#FFD600]/10 p-3 text-xs space-y-1">
                    <p className="font-bold text-[#FFD600]">
                      Reserva próxima ({reservationByTableId.get(selectedTable.id)!.startTime} –{' '}
                      {reservationByTableId.get(selectedTable.id)!.endTime})
                    </p>
                    <p className="text-neutral-200">
                      {reservationByTableId.get(selectedTable.id)!.customerName} ·{' '}
                      {reservationByTableId.get(selectedTable.id)!.serviceMode === 'PARA_LLEVAR'
                        ? 'Alistar Para Llevar'
                        : 'En Mesa'}
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setReserveTableId(selectedTable.id);
                    setActiveTab('RESERVAS');
                  }}
                  className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-[#2E2E2E] bg-[#141414] px-3 text-xs font-bold text-[#FFD600] hover:border-[#FFD600]"
                >
                  <CalendarClock className="h-4 w-4" />
                  <span>Reservar {selectedTable.label} por Horas</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: RESERVAS POR HORAS */}
      {activeTab === 'RESERVAS' && (
        <ReservationManagerPanel
          state={state}
          preselectedTableId={reserveTableId}
          onApiAction={onApiAction}
        />
      )}

      {/* TAB 2: COMANDAS Y ESTADOS DE COCINA */}
      {activeTab === 'COMANDAS' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {activeOrdersList.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-[#2A2A2A] bg-[#181818] p-10 text-center text-neutral-400">
              Aún no hay comandas registradas en este turno.
            </div>
          ) : (
            activeOrdersList.map((ord) => (
              <div key={ord.id} className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-[#262626] pb-2.5">
                  <div>
                    <p className="font-mono text-sm font-bold text-white">{ord.orderCode}</p>
                    <p className="text-xs text-neutral-400">
                      {ord.tableLabel} · {ord.customerName}
                    </p>
                  </div>
                  <span
                    className={`flex items-center gap-1 text-xs font-extrabold ${
                      ord.kitchenStatus === 'LISTO'
                        ? 'text-emerald-400'
                        : ord.kitchenStatus === 'EN_PREPARACION'
                          ? 'text-[#FFD600]'
                          : ord.kitchenStatus === 'NUEVO'
                            ? 'text-red-400'
                            : 'text-neutral-400'
                    }`}
                  >
                    {ord.kitchenStatus === 'LISTO' ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                    {ord.kitchenStatus.replace('_', ' ')}
                  </span>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {ord.items.map((it) => (
                    <li key={it.id} className="flex justify-between gap-2">
                      <span className="text-neutral-200">
                        <strong className="text-white">{it.quantity}x</strong> {it.productNameSnapshot}
                        {it.notes && <span className="block text-xs text-[#FFD600]">Obs: {it.notes}</span>}
                      </span>
                      <span className="font-mono text-xs text-neutral-400 tabular-nums">
                        S/ {(it.quantity * it.unitPriceSnapshot).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#262626] pt-2 text-xs text-neutral-400">
                  <span>{new Date(ord.createdAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>
                    Tomó: {ord.waiterName}
                    {ord.deliveryWaiterName && (
                      <>
                        {' · '}
                        <strong className="text-sky-300">Entrega: {ord.deliveryWaiterName}</strong>
                      </>
                    )}
                    {ord.deliveryDestination && (
                      <>
                        {' · '}
                        <strong className="text-[#FFD600]">Enviar a: {ord.deliveryDestination}</strong>
                      </>
                    )}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* TAB 3: CLIENTES REGISTRADOS */}
      {activeTab === 'CLIENTES' && (
        <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
          <h3 className="font-display text-lg font-bold text-white mb-4 flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[#FFD600]" />
            <span>Directorio de Clientes</span>
          </h3>
          {state.customers.length === 0 ? (
            <p className="text-sm text-neutral-400">
              Los clientes se guardan automáticamente cada vez que registras un pedido con su nombre.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {state.customers.map((c) => (
                <div key={c.id} className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-3.5">
                  <p className="font-bold text-white">{c.name}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    {c.phone ? `Tel: ${c.phone}` : 'Sin teléfono registrado'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODAL / DRAWER DE TOMA DE PEDIDO */}
      {isOrderDrawerOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-[#2E2E2E] bg-[#141414] sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-[#262626] px-4 py-3 sm:px-5 sm:py-4">
              <div className="min-w-0">
                <h3 className="font-display text-base font-extrabold text-[#FFD600] truncate sm:text-lg">
                  {isTakeawayMode
                    ? 'Nuevo Pedido Para Llevar'
                    : `${selectedTable?.label} · ${activeTableAccount ? 'Agregar Productos' : 'Nuevo Pedido'}`}
                </h3>
                <p className="text-xs text-neutral-400">
                  {cart.length > 0
                    ? `${cart.reduce((s, c) => s + c.quantity, 0)} producto(s) · Total S/ ${cartTotal.toFixed(2)}`
                    : 'Toca Agregar en los platos del pedido'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOrderDrawerOpen(false)}
                aria-label="Cerrar"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#2E2E2E] text-neutral-300 hover:bg-[#242424]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-12">
              {/* Catálogo */}
              <div className="flex flex-col border-b border-[#262626] p-3 sm:p-4 lg:col-span-7 lg:border-r lg:border-b-0">
                <div className="mb-2.5 grid grid-cols-2 gap-2 sm:mb-4 sm:gap-3">
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Cliente (Ej: Juan)"
                    className="h-10 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white placeholder-neutral-500 focus:border-[#FFD600] focus:outline-none sm:h-11 sm:px-3.5"
                  />
                  <input
                    type="text"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Teléfono opcional"
                    className="h-10 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white placeholder-neutral-500 focus:border-[#FFD600] focus:outline-none sm:h-11 sm:px-3.5"
                  />
                  {isTakeawayMode && (
                    <input
                      type="text"
                      value={deliveryDestination}
                      onChange={(e) => setDeliveryDestination(e.target.value)}
                      placeholder="Destino / Dirección (Ej: Mostrador o Jr. Puno 210)"
                      className="col-span-2 h-10 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white placeholder-neutral-500 focus:border-[#FFD600] focus:outline-none sm:h-11 sm:px-3.5"
                    />
                  )}
                </div>

                {/* Categorías */}
                <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1 sm:mb-4 sm:gap-2">
                  {activeCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategoryId(cat.id)}
                      className={`min-h-[40px] rounded-xl px-3 py-1.5 text-xs font-bold whitespace-nowrap shrink-0 transition-colors sm:px-3.5 sm:py-2 ${
                        (selectedCategoryId || activeCategories[0]?.id) === cat.id
                          ? 'bg-[#FFD600] text-[#111111]'
                          : 'bg-[#1E1E1E] text-neutral-300 hover:bg-[#2A2A2A]'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>

                {/* Productos: tarjetas compactas sin imagen en web, APK y tablet (solo nombre, precio e ingredientes) */}
                <div className="flex flex-col gap-1.5 sm:grid sm:grid-cols-2 sm:gap-2">
                  {filteredProducts.map((prod) => {
                    const ingredientsText = prod.description?.trim() || recipeIngredientsMap.get(prod.id) || '';
                    const qtyInCart = cart
                      .filter((c) => c.product.id === prod.id)
                      .reduce((sum, c) => sum + c.quantity, 0);
                    return (
                      <div
                        key={prod.id}
                        className={`flex flex-row items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                          !prod.isAvailable
                            ? 'border-[#242424] bg-[#151515] opacity-55'
                            : qtyInCart > 0
                              ? 'border-[#FFD600]/70 bg-[#1E1C12]'
                              : 'border-[#2B2B2B] bg-[#1A1A1A]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="font-display text-sm font-extrabold text-white leading-tight truncate">
                              {prod.name}
                            </h4>
                            <span className="font-mono text-sm font-extrabold text-[#FFD600] tabular-nums shrink-0">
                              S/ {prod.price.toFixed(2)}
                            </span>
                          </div>
                          {ingredientsText && (
                            <p className="mt-0.5 text-[11px] text-neutral-400 leading-snug line-clamp-2">
                              {ingredientsText}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={!prod.isAvailable}
                          onClick={() => addToCart(prod)}
                          className="flex min-h-[38px] shrink-0 items-center justify-center gap-1 rounded-lg bg-[#E31B23] px-2.5 py-1.5 text-xs font-extrabold text-white hover:bg-[#c8161d] disabled:bg-neutral-700 whitespace-nowrap"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>
                            {!prod.isAvailable
                              ? 'Agotado'
                              : qtyInCart > 0
                                ? `(${qtyInCart})`
                                : 'Agregar'}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Carrito de la Comanda */}
              <div id="order-cart-section" className="flex flex-col justify-between bg-[#121212] p-4 lg:col-span-5">
                <div className="space-y-3">
                  <h4 className="font-display text-base font-bold text-white">
                    Detalle del Pedido ({cart.reduce((s, c) => s + c.quantity, 0)} ítems)
                  </h4>

                  {cart.length === 0 ? (
                    <p className="py-10 text-center text-sm text-neutral-500">
                      Toca los platos de la carta para añadirlos a esta comanda.
                    </p>
                  ) : (
                    <div className="max-h-[340px] space-y-2.5 overflow-y-auto pr-1">
                      {cart.map((line, idx) => (
                        <div key={`${line.product.id}-${idx}`} className="rounded-xl border border-[#262626] bg-[#191919] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-white truncate">{line.product.name}</p>
                              <p className="font-mono text-xs text-[#FFD600] tabular-nums">
                                S/ {(line.product.price * line.quantity).toFixed(2)}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => updateCartQty(idx, -1)}
                                className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#2E2E2E] bg-[#121212] text-white hover:bg-[#262626]"
                              >
                                <Minus className="h-4 w-4" />
                              </button>
                              <span className="w-7 text-center font-mono text-sm font-bold tabular-nums">
                                {line.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateCartQty(idx, 1)}
                                className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#2E2E2E] bg-[#121212] text-white hover:bg-[#262626]"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteIdx(idx);
                                setNoteDraft(line.notes);
                              }}
                              className="flex items-center gap-1 text-xs font-medium text-neutral-300 hover:text-[#FFD600]"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              <span>{line.notes ? `Obs: ${line.notes}` : 'Agregar observación'}</span>
                            </button>
                          </div>

                          {editingNoteIdx === idx && (
                            <div className="mt-2 flex gap-2">
                              <input
                                type="text"
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                                placeholder="Ej: Sin ají, cremas aparte"
                                className="h-9 flex-1 rounded-lg border border-[#333333] bg-[#111111] px-2.5 text-xs text-white"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  setCart((prev) =>
                                    prev.map((c, i) => (i === idx ? { ...c, notes: noteDraft.trim() } : c))
                                  );
                                  setEditingNoteIdx(null);
                                }}
                                className="rounded-lg bg-[#FFD600] px-3 text-xs font-bold text-[#111111]"
                              >
                                OK
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="mt-4 border-t border-[#262626] pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-neutral-400">Total de Comanda</span>
                    <span className="font-mono text-2xl font-extrabold text-[#FFD600] tabular-nums">
                      S/ {cartTotal.toFixed(2)}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={cart.length === 0 || submitting}
                    onClick={handleConfirmOrder}
                    className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-5 py-3 text-sm font-extrabold text-[#111111] hover:bg-[#f2ca00] disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                    <span>{submitting ? 'Enviando...' : 'Confirmar y Enviar a Cocina'}</span>
                  </button>
                </div>
              </div>
            </div>

            {cart.length > 0 && (
              <div className="flex items-center justify-between gap-2 border-t border-[#262626] bg-[#161616] px-3 py-2.5 lg:hidden">
                <button
                  type="button"
                  onClick={() =>
                    document.getElementById('order-cart-section')?.scrollIntoView({ behavior: 'smooth' })
                  }
                  className="min-h-[44px] flex-1 rounded-xl border border-[#2E2E2E] bg-[#1E1E1E] px-3 text-left text-xs font-bold text-white"
                >
                  <span className="text-neutral-400">Ver pedido ({cart.reduce((s, c) => s + c.quantity, 0)}): </span>
                  <span className="font-mono font-extrabold text-[#FFD600] tabular-nums">
                    S/ {cartTotal.toFixed(2)}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleConfirmOrder}
                  className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl bg-[#FFD600] px-4 text-xs font-extrabold text-[#111111] disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>{submitting ? 'Enviando...' : 'Enviar'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal rápido para agregar, activar/desactivar y eliminar Mozos (solo Administrador) */}
      {showAddWaiterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#2E2E2E] bg-[#161616] p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-extrabold text-white">Control de Mozos (Administrador)</h3>
                <p className="mt-1 text-xs text-neutral-400">
                  Agrega nuevos mozos, suspende accesos o elimínalos permanentemente.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAddWaiterModal(false);
                  setConfirmDeleteWaiterId(null);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-[#242424]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const mozoRoleId = state.roles.find((r) => r.name === 'MOZO')?.id ?? 'role-mozo';
                const passToUse = waiterPassword.trim() || '1111';
                const ok = await onApiAction(
                  'POST',
                  '/api/users',
                  {
                    fullName: waiterFullName,
                    username: waiterUsername,
                    password: passToUse,
                    roleId: mozoRoleId,
                  },
                  `Nuevo mozo ${waiterFullName}`
                );
                if (ok) {
                  setWaiterFullName('');
                  setWaiterUsername('');
                  setWaiterPassword('1111');
                }
              }}
              className="space-y-3 rounded-xl border border-[#262626] bg-[#111111] p-4"
            >
              <p className="text-xs font-bold text-[#FFD600]">Registrar Nuevo Mozo</p>
              <input
                type="text"
                required
                value={waiterFullName}
                onChange={(e) => setWaiterFullName(e.target.value)}
                placeholder="Nombre completo (Ej: Ana Torres)"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#181818] px-3 text-sm text-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={waiterUsername}
                  onChange={(e) => setWaiterUsername(e.target.value)}
                  placeholder="Usuario (Ej: mozo2)"
                  className="h-11 rounded-xl border border-[#2E2E2E] bg-[#181818] px-3 text-sm text-white"
                />
                <input
                  type="password"
                  minLength={4}
                  value={waiterPassword}
                  onChange={(e) => setWaiterPassword(e.target.value)}
                  placeholder="Contraseña (defecto: 1111)"
                  className="h-11 rounded-xl border border-[#2E2E2E] bg-[#181818] px-3 text-sm text-white"
                />
              </div>
              <button
                type="submit"
                className="min-h-[42px] w-full rounded-xl bg-[#FFD600] px-4 text-xs font-extrabold text-[#111111]"
              >
                + Agregar Mozo
              </button>
            </form>

            <div className="space-y-2">
              <p className="text-xs font-bold text-neutral-300">
                Mozos Registrados ({state.users.filter((u) => u.roleName === 'MOZO').length})
              </p>
              {state.users.filter((u) => u.roleName === 'MOZO').length === 0 ? (
                <p className="text-xs text-neutral-500">No hay mozos registrados todavía.</p>
              ) : (
                state.users
                  .filter((u) => u.roleName === 'MOZO')
                  .map((w) => (
                    <div
                      key={w.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#262626] bg-[#121212] px-3.5 py-2.5 text-xs"
                    >
                      <div>
                        <p className="font-bold text-white">{w.fullName}</p>
                        <p className="text-neutral-400">@{w.username}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            onApiAction(
                              'PATCH',
                              `/api/users/${w.id}`,
                              { isActive: !w.isActive },
                              `${w.isActive ? 'Desactivar' : 'Activar'} mozo ${w.username}`
                            )
                          }
                          className={`rounded-lg px-2.5 py-1.5 font-bold ${
                            w.isActive ? 'bg-emerald-600/20 text-emerald-400' : 'bg-amber-600/20 text-amber-300'
                          }`}
                        >
                          {w.isActive ? 'Activo' : 'Inactivo'}
                        </button>
                        {confirmDeleteWaiterId === w.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                await onApiAction('DELETE', `/api/users/${w.id}`, undefined, `Eliminar mozo ${w.fullName}`);
                                setConfirmDeleteWaiterId(null);
                              }}
                              className="rounded-lg bg-[#E31B23] px-2.5 py-1.5 font-bold text-white"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteWaiterId(null)}
                              className="rounded-lg bg-[#262626] px-2 py-1.5 text-neutral-300"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteWaiterId(w.id)}
                            className="flex items-center gap-1 rounded-lg bg-[#E31B23]/20 px-2.5 py-1.5 font-bold text-red-400 hover:bg-[#E31B23] hover:text-white"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Eliminar</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
