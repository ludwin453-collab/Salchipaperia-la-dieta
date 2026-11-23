import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Package,
  ChefHat,
  ShoppingCart,
  BarChart3,
  ShieldCheck,
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Download,
  Utensils,
  Edit3,
  Trash2,
  Clock,
  CheckCircle2,
  CalendarClock,
} from 'lucide-react';
import type {
  Ingredient,
  PosBootstrapState,
  Product,
  User,
} from '../types/pos';
import { exportReportsExcel, exportReportsPdf } from '../lib/exportUtils';
import { ReservationManagerPanel } from './ReservationManagerPanel';

interface AdminViewProps {
  state: PosBootstrapState;
  currentUser: User;
  onApiAction: (
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body: unknown,
    description: string
  ) => Promise<unknown>;
}

const INGREDIENT_CATEGORIES = [
  'Papas',
  'Salchichas',
  'Pollo',
  'Queso',
  'Huevos',
  'Arroz',
  'Aceite',
  'Verduras',
  'Salsas',
  'Condimentos',
  'Bebidas',
  'Envases',
  'Ingredientes para anticuchos',
];

type AdminSubTab = 'MESAS' | 'CARTA' | 'INVENTARIO' | 'COMPRAS' | 'REPORTES' | 'SEGURIDAD';

function formatElapsedCompact(startIso: string, nowMs: number): { label: string; minutes: number } {
  const diffSec = Math.max(0, Math.floor((nowMs - new Date(startIso).getTime()) / 1000));
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remM = mins % 60;
    return { label: `${hrs}h ${String(remM).padStart(2, '0')}m`, minutes: mins };
  }
  return { label: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`, minutes: mins };
}

export function AdminView({
  state,
  currentUser,
  onApiAction,
}: AdminViewProps) {
  const [subTab, setSubTab] = useState<AdminSubTab>('MESAS');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reserveTableId, setReserveTableId] = useState<string>('');

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Carta: nueva categoría / producto / editar
  const [newCatName, setNewCatName] = useState('');
  const [newCatSub, setNewCatSub] = useState('');
  const [newProdCatId, setNewProdCatId] = useState(state.categories[0]?.id ?? '');
  const [newProdName, setNewProdName] = useState('');
  const [newProdDesc, setNewProdDesc] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('');
  const [newProdKitchen, setNewProdKitchen] = useState(true);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editAvail, setEditAvail] = useState(true);

  // Inventario: nuevo ingrediente / receta / ajuste
  const [ingCat, setIngCat] = useState(INGREDIENT_CATEGORIES[0]);
  const [ingName, setIngName] = useState('');
  const [ingUnit, setIngUnit] = useState<Ingredient['unit']>('kg');
  const [ingMin, setIngMin] = useState('5');
  const [ingExp, setIngExp] = useState('');

  const [recipeProductId, setRecipeProductId] = useState(state.products[0]?.id ?? '');
  const [recipeDraft, setRecipeDraft] = useState<Array<{ ingredientId: string; quantity: string }>>([]);

  const [adjIngId, setAdjIngId] = useState(state.ingredients[0]?.id ?? '');
  const [adjType, setAdjType] = useState<'AJUSTE' | 'MERMA' | 'DEVOLUCION'>('MERMA');
  const [adjQty, setAdjQty] = useState('');
  const [adjReason, setAdjReason] = useState('');

  // Compras & Proveedores
  const [supName, setSupName] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [purSupId, setPurSupId] = useState(state.suppliers[0]?.id ?? '');
  const [purIngId, setPurIngId] = useState(state.ingredients[0]?.id ?? '');
  const [purQty, setPurQty] = useState('');
  const [purUnitPrice, setPurUnitPrice] = useState('');

  // Reportes
  const todayStr = new Date().toISOString().slice(0, 10);
  const monthStartStr = `${todayStr.slice(0, 7)}-01`;
  const [fromDate, setFromDate] = useState(monthStartStr);
  const [toDate, setToDate] = useState(todayStr);

  // Seguridad / Mesas / Usuarios
  const [newTableNum, setNewTableNum] = useState('');
  const [newUserFull, setNewUserFull] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPass, setNewUserPass] = useState('1111');
  const [newUserRoleId, setNewUserRoleId] = useState(
    state.roles.find((r) => r.name === 'MOZO')?.id ?? 'role-mozo'
  );
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editUserFullName, setEditUserFullName] = useState('');
  const [editUserRoleId, setEditUserRoleId] = useState('');
  const [editUserPassword, setEditUserPassword] = useState('');
  const [gateEditUser, setGateEditUser] = useState('');
  const [gateEditPass, setGateEditPass] = useState('');

  const categoryMap = useMemo(() => new Map(state.categories.map((c) => [c.id, c])), [state.categories]);
  const recipeMap = useMemo(() => new Map(state.recipes.map((r) => [r.productId, r])), [state.recipes]);
  const accountMap = useMemo(() => new Map(state.accounts.map((a) => [a.id, a])), [state.accounts]);
  const lowStockIngredients = useMemo(
    () => state.ingredients.filter((i) => i.currentStock <= i.minStock),
    [state.ingredients]
  );

  const tableTrackingRows = useMemo(() => {
    const d = new Date(nowMs);
    const todayLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;

    return state.tables.map((table) => {
      const acc = table.activeAccountId ? accountMap.get(table.activeAccountId) ?? null : null;
      const activeOrders = acc
        ? state.orders.filter((o) => o.accountId === acc.id && o.kitchenStatus !== 'ANULADO')
        : [];
      const pendingKitchen = activeOrders.filter(
        (o) => o.kitchenStatus === 'NUEVO' || o.kitchenStatus === 'EN_PREPARACION' || o.kitchenStatus === 'LISTO'
      );
      const unconfirmedDelivered = activeOrders.filter(
        (o) => o.kitchenStatus === 'ENTREGADO' && !o.waiterConfirmedAt
      );
      const activeReservation =
        state.reservations.find(
          (r) =>
            r.tableId === table.id &&
            r.reservationDate >= todayLocal &&
            (r.status === 'PENDIENTE' || r.status === 'EN_PREPARACION')
        ) ?? null;

      let attentionState:
        | 'LIBRE'
        | 'SIN_PEDIDO'
        | 'EN_COCINA'
        | 'LISTO_POR_SERVIR'
        | 'MOZO_EN_CAMINO'
        | 'ATENDIDA'
        | 'LIMPIEZA' = 'LIBRE';
      let attentionLabel = 'Disponible sin clientes';
      let waitSinceIso: string | null = null;
      let isWaiting = false;

      if (table.status === 'EN_LIMPIEZA') {
        attentionState = 'LIMPIEZA';
        attentionLabel = 'En limpieza';
      } else if (acc) {
        if (activeOrders.length === 0) {
          attentionState = 'SIN_PEDIDO';
          attentionLabel = 'No atendida · Sin pedido enviado';
          waitSinceIso = acc.openedAt;
          isWaiting = true;
        } else if (pendingKitchen.some((o) => o.kitchenStatus === 'LISTO')) {
          attentionState = 'LISTO_POR_SERVIR';
          attentionLabel = 'Listo en cocina · Esperando mozo';
          const oldest = pendingKitchen.find((o) => o.kitchenStatus === 'LISTO')!;
          waitSinceIso = oldest.readyAt ?? oldest.createdAt;
          isWaiting = true;
        } else if (pendingKitchen.length > 0) {
          attentionState = 'EN_COCINA';
          const hasPrep = pendingKitchen.some((o) => o.kitchenStatus === 'EN_PREPARACION');
          attentionLabel = hasPrep ? 'No atendida · En preparación' : 'No atendida · Cola de cocina';
          waitSinceIso = pendingKitchen[0].createdAt;
          isWaiting = true;
        } else if (unconfirmedDelivered.length > 0) {
          attentionState = 'MOZO_EN_CAMINO';
          attentionLabel = 'Entregado por cocina · En camino a mesa';
          waitSinceIso = unconfirmedDelivered[0].deliveredAt ?? unconfirmedDelivered[0].createdAt;
          isWaiting = true;
        } else {
          attentionState = 'ATENDIDA';
          attentionLabel = 'Atendida ✓';
          waitSinceIso = acc.openedAt;
          isWaiting = false;
        }
      }

      const elapsed = waitSinceIso ? formatElapsedCompact(waitSinceIso, nowMs) : null;
      return {
        table,
        acc,
        activeOrders,
        activeReservation,
        attentionState,
        attentionLabel,
        elapsed,
        isWaiting,
      };
    });
  }, [state.tables, state.orders, state.reservations, accountMap, nowMs]);

  // Cargar borrador de receta al cambiar producto
  const loadRecipeForProduct = (prodId: string) => {
    setRecipeProductId(prodId);
    const existing = recipeMap.get(prodId);
    if (existing && existing.items.length > 0) {
      setRecipeDraft(
        existing.items.map((it) => ({
          ingredientId: it.ingredientId,
          quantity: String(it.quantity),
        }))
      );
    } else {
      setRecipeDraft([]);
    }
  };

  // Cálculos de los 12 reportes en el rango seleccionado
  const reportData = useMemo(() => {
    const fromMs = new Date(`${fromDate}T00:00:00`).getTime();
    const toMs = new Date(`${toDate}T23:59:59.999`).getTime();
    const inRange = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= fromMs && t <= toMs;
    };

    const salesPayments = state.payments.filter(
      (p) => p.movementType === 'INGRESO_VENTA' && inRange(p.createdAt)
    );
    const totalSales = salesPayments.reduce((s, p) => s + p.amount, 0);

    const byMethodMap = new Map<string, number>();
    for (const p of salesPayments) {
      byMethodMap.set(p.method, (byMethodMap.get(p.method) ?? 0) + p.amount);
    }

    const dailyMap = new Map<string, number>();
    const monthlyMap = new Map<string, number>();
    for (const p of salesPayments) {
      const day = p.createdAt.slice(0, 10);
      const month = p.createdAt.slice(0, 7);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + p.amount);
      monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + p.amount);
    }

    const prodMap = new Map(state.products.map((p) => [p.id, p]));
    const byProd = new Map<string, { name: string; qty: number; revenue: number; estCost: number }>();
    const byCat = new Map<string, number>();
    const byWaiter = new Map<string, { name: string; orders: number; total: number }>();
    let totalEstimatedCost = 0;

    for (const ord of state.orders.filter((o) => o.kitchenStatus !== 'ANULADO' && inRange(o.createdAt))) {
      let ordTotal = 0;
      for (const it of ord.items) {
        const rev = it.unitPriceSnapshot * it.quantity;
        const unitCost = recipeMap.get(it.productId)?.estimatedCost ?? 0;
        const lineCost = unitCost * it.quantity;
        ordTotal += rev;
        totalEstimatedCost += lineCost;

        const curP = byProd.get(it.productId) ?? {
          name: it.productNameSnapshot,
          qty: 0,
          revenue: 0,
          estCost: 0,
        };
        curP.qty += it.quantity;
        curP.revenue += rev;
        curP.estCost += lineCost;
        byProd.set(it.productId, curP);

        const prod = prodMap.get(it.productId);
        const catName = prod ? categoryMap.get(prod.categoryId)?.name ?? 'Otro' : 'Otro';
        byCat.set(catName, (byCat.get(catName) ?? 0) + rev);
      }

      const curW = byWaiter.get(ord.waiterId) ?? { name: ord.waiterName ?? 'Mozo', orders: 0, total: 0 };
      curW.orders += 1;
      curW.total += ordTotal;
      byWaiter.set(ord.waiterId, curW);
    }

    const totalPurchases = state.purchases
      .filter((p) => inRange(p.purchasedAt))
      .reduce((s, p) => s + p.totalAmount, 0);

    const totalWasteLoss = state.wasteRecords
      .filter((w) => inRange(w.createdAt))
      .reduce((s, w) => s + w.estimatedLoss, 0);

    const consumptionByIng = new Map<string, { name: string; unit: string; qty: number }>();
    for (const m of state.movements.filter((m) => m.movementType === 'CONSUMO_VENTA' && inRange(m.createdAt))) {
      const cur = consumptionByIng.get(m.ingredientId) ?? {
        name: m.ingredientName ?? 'Ingrediente',
        unit: m.ingredientUnit ?? '',
        qty: 0,
      };
      cur.qty += Math.abs(m.quantityDelta);
      consumptionByIng.set(m.ingredientId, cur);
    }

    return {
      totalSales,
      totalEstimatedCost,
      grossProfit: totalSales - totalEstimatedCost,
      totalPurchases,
      totalWasteLoss,
      byMethod: Array.from(byMethodMap.entries()).map(([method, total]) => ({ method, total })),
      daily: Array.from(dailyMap.entries()).sort((a, b) => b[0].localeCompare(a[0])),
      monthly: Array.from(monthlyMap.entries()).sort((a, b) => b[0].localeCompare(a[0])),
      topProducts: Array.from(byProd.values()).sort((a, b) => b.revenue - a.revenue),
      byCategory: Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]),
      byWaiter: Array.from(byWaiter.values()).sort((a, b) => b.total - a.total),
      consumption: Array.from(consumptionByIng.values()).sort((a, b) => b.qty - a.qty),
    };
  }, [state, fromDate, toDate, categoryMap, recipeMap]);

  const handleDownloadBackup = async () => {
    const res = await fetch('/api/backup', {
      headers: { 'x-user-id': state.users.find((u) => u.roleName === 'ADMINISTRADOR')?.id ?? '' },
    });
    if (!res.ok) return;
    const blob = new Blob([await res.text()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LaDieta_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 pb-16">
      <div className="flex flex-col gap-4 border-b border-[#262626] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-extrabold text-white">Administración y Gerencia</h2>
          <p className="text-sm text-neutral-400">
            Control total de carta, recetas reales, compras, inventarios, reportes y seguridad.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            { id: 'MESAS', label: 'Mesas y Reservas', icon: Clock },
            { id: 'CARTA', label: 'Carta y Precios', icon: Utensils },
            { id: 'INVENTARIO', label: 'Inventario y Recetas', icon: ChefHat },
            { id: 'COMPRAS', label: 'Compras', icon: ShoppingCart },
            { id: 'REPORTES', label: 'Reportes', icon: BarChart3 },
            { id: 'SEGURIDAD', label: 'Usuarios y Mesas', icon: ShieldCheck },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id as AdminSubTab)}
                className={`flex min-h-[44px] items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition-colors whitespace-nowrap ${
                  subTab === t.id
                    ? 'bg-[#FFD600] text-[#111111]'
                    : 'bg-[#1A1A1A] text-neutral-300 hover:bg-[#242424]'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SUBTAB 0: SEGUIMIENTO DE ATENCIÓN DE MESAS Y RESERVAS POR HORAS */}
      {subTab === 'MESAS' && (
        <div className="space-y-6">
          {/* KPIs de Atención en Salón */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-2xl border border-emerald-500/30 bg-[#181818] p-4">
              <p className="text-xs text-neutral-400">Mesas Disponibles</p>
              <p className="mt-1 font-mono text-2xl font-extrabold text-emerald-400 tabular-nums">
                {tableTrackingRows.filter((r) => r.table.status === 'LIBRE').length}
              </p>
            </div>
            <div className="rounded-2xl border border-[#E31B23]/40 bg-[#181818] p-4">
              <p className="text-xs text-neutral-400">Esperando Atención / Cocina</p>
              <p className="mt-1 font-mono text-2xl font-extrabold text-[#FFD600] tabular-nums">
                {tableTrackingRows.filter((r) => r.isWaiting).length}
              </p>
            </div>
            <div className="rounded-2xl border border-sky-500/30 bg-[#181818] p-4">
              <p className="text-xs text-neutral-400">Mesas Ya Atendidas</p>
              <p className="mt-1 font-mono text-2xl font-extrabold text-sky-300 tabular-nums">
                {tableTrackingRows.filter((r) => r.attentionState === 'ATENDIDA').length}
              </p>
            </div>
            <div className="rounded-2xl border border-[#FFD600]/30 bg-[#181818] p-4">
              <p className="text-xs text-neutral-400">Reservas Activas</p>
              <p className="mt-1 font-mono text-2xl font-extrabold text-white tabular-nums">
                {
                  state.reservations.filter(
                    (r) => r.status === 'PENDIENTE' || r.status === 'EN_PREPARACION'
                  ).length
                }
              </p>
            </div>
          </div>

          {/* Monitor de Atención por Mesa */}
          <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-extrabold text-white">
                  Seguimiento de Atención por Mesa
                </h3>
                <p className="text-xs text-neutral-400">
                  Control en vivo de estado, si el usuario ya fue atendido y cuánto tiempo lleva esperando.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {tableTrackingRows.map((row) => {
                const { table, acc, activeOrders, activeReservation, attentionState, attentionLabel, elapsed, isWaiting } = row;
                const isDelayed = isWaiting && elapsed && elapsed.minutes >= 10;
                const borderCls = isDelayed
                  ? 'border-[#E31B23] bg-[#241315]'
                  : isWaiting
                    ? 'border-[#FFD600]/70 bg-[#1F1C12]'
                    : attentionState === 'ATENDIDA'
                      ? 'border-sky-500/50 bg-[#121A22]'
                      : table.status === 'EN_LIMPIEZA'
                        ? 'border-amber-500/50 bg-[#1D1810]'
                        : 'border-emerald-500/40 bg-[#131D17]';

                return (
                  <div
                    key={table.id}
                    className={`flex flex-col justify-between rounded-xl border p-3.5 space-y-2.5 ${borderCls}`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-base font-extrabold text-white">
                          {table.label}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                            table.status === 'LIBRE'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : table.status === 'PENDIENTE_PAGO'
                                ? 'bg-amber-500/20 text-amber-300'
                                : table.status === 'EN_LIMPIEZA'
                                  ? 'bg-sky-500/20 text-sky-300'
                                  : 'bg-[#E31B23]/25 text-red-300'
                          }`}
                        >
                          {table.status.replace('_', ' ')}
                        </span>
                      </div>

                      {/* Estado de Atención + Cronómetro */}
                      <div className="rounded-lg bg-black/35 px-2.5 py-2 text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-bold">
                          {attentionState === 'ATENDIDA' ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                          ) : isWaiting ? (
                            <Clock className={`h-3.5 w-3.5 shrink-0 ${isDelayed ? 'text-red-400' : 'text-[#FFD600]'}`} />
                          ) : null}
                          <span
                            className={
                              isDelayed
                                ? 'text-red-300'
                                : isWaiting
                                  ? 'text-[#FFD600]'
                                  : attentionState === 'ATENDIDA'
                                    ? 'text-emerald-300'
                                    : 'text-neutral-400'
                            }
                          >
                            {attentionLabel}
                          </span>
                        </div>

                        {elapsed && (
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-neutral-400">
                              {isWaiting ? 'Tiempo esperando:' : 'Tiempo en mesa:'}
                            </span>
                            <span
                              className={`font-mono font-extrabold tabular-nums ${
                                isDelayed ? 'text-red-400' : isWaiting ? 'text-[#FFD600]' : 'text-white'
                              }`}
                            >
                              {elapsed.label}
                            </span>
                          </div>
                        )}
                      </div>

                      {acc && (
                        <div className="text-[11px] text-neutral-300 space-y-0.5">
                          <p className="truncate">
                            Cliente: <strong className="text-white">{acc.mainCustomerName}</strong>
                          </p>
                          <p className="truncate">
                            Mozo: <strong className="text-neutral-200">{acc.waiterName}</strong>
                          </p>
                          <div className="flex items-center justify-between pt-0.5">
                            <span>{activeOrders.length} comanda(s)</span>
                            <span className="font-mono font-bold text-[#FFD600] tabular-nums">
                              S/ {(acc.totalAmount - acc.paidAmount).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )}

                      {activeReservation && (
                        <div className="rounded-lg border border-[#FFD600]/40 bg-[#FFD600]/10 px-2.5 py-1.5 text-[11px]">
                          <p className="font-bold text-[#FFD600]">
                            Reserva: {activeReservation.startTime} – {activeReservation.endTime}
                          </p>
                          <p className="truncate text-neutral-200">
                            {activeReservation.customerName} ({activeReservation.serviceMode === 'PARA_LLEVAR' ? 'Para llevar' : 'En mesa'})
                          </p>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setReserveTableId(table.id);
                        document.getElementById('admin-reservations-section')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="flex min-h-[34px] w-full items-center justify-center gap-1 rounded-lg border border-[#2E2E2E] bg-[#141414] px-2 text-[11px] font-bold text-neutral-200 hover:border-[#FFD600] hover:text-[#FFD600]"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      <span>Reservar por Horas</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Gestión de Reservas por Horas (En Mesa o Alistar Para Llevar) */}
          <div id="admin-reservations-section">
            <ReservationManagerPanel
              state={state}
              preselectedTableId={reserveTableId}
              onApiAction={onApiAction}
            />
          </div>
        </div>
      )}

      {/* SUBTAB 1: CARTA, CATEGORÍAS FUTURAS Y PRECIOS DINÁMICOS */}
      {subTab === 'CARTA' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-5">
            {/* Nueva Categoría */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onApiAction(
                  'POST',
                  '/api/categories',
                  { name: newCatName, subtitle: newCatSub },
                  `Nueva categoría ${newCatName}`
                );
                if (ok) {
                  setNewCatName('');
                  setNewCatSub('');
                }
              }}
              className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-3"
            >
              <h3 className="font-display text-base font-bold text-white">
                Agregar Categoría (Anticuchos, Parrillas, Hamburguesas…)
              </h3>
              <input
                type="text"
                required
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Nombre de categoría"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              />
              <input
                type="text"
                value={newCatSub}
                onChange={(e) => setNewCatSub(e.target.value)}
                placeholder="Subtítulo comercial opcional"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              />
              <button
                type="submit"
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] text-xs font-extrabold text-[#111111]"
              >
                <Plus className="h-4 w-4" />
                <span>Crear Categoría</span>
              </button>
            </form>

            {/* Nuevo Producto */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onApiAction(
                  'POST',
                  '/api/products',
                  {
                    categoryId: newProdCatId || state.categories[0]?.id,
                    name: newProdName,
                    description: newProdDesc,
                    price: Number.parseFloat(newProdPrice) || 0,
                    imageUrl: null,
                    requiresKitchen: newProdKitchen,
                  },
                  `Nuevo producto ${newProdName}`
                );
                if (ok) {
                  setNewProdName('');
                  setNewProdDesc('');
                  setNewProdPrice('');
                }
              }}
              className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-3"
            >
              <h3 className="font-display text-base font-bold text-white">Agregar Producto a la Carta</h3>
              <select
                value={newProdCatId}
                onChange={(e) => setNewProdCatId(e.target.value)}
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              >
                {state.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                value={newProdName}
                onChange={(e) => setNewProdName(e.target.value)}
                placeholder="Nombre del plato o bebida"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              />
              <input
                type="text"
                value={newProdDesc}
                onChange={(e) => setNewProdDesc(e.target.value)}
                placeholder="Ingredientes (Ej: Papas fritas + salchicha + huevo)"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              />
              <input
                type="number"
                step="0.10"
                min="0"
                required
                value={newProdPrice}
                onChange={(e) => setNewProdPrice(e.target.value)}
                placeholder="Precio S/"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-sm text-white"
              />
              <label className="flex items-center gap-2 text-xs text-neutral-300">
                <input
                  type="checkbox"
                  checked={newProdKitchen}
                  onChange={(e) => setNewProdKitchen(e.target.checked)}
                  className="h-4 w-4 accent-[#FFD600]"
                />
                <span>Requiere preparación en cocina (comanda KDS)</span>
              </label>
              <button
                type="submit"
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#E31B23] text-xs font-extrabold text-white"
              >
                <Plus className="h-4 w-4" />
                <span>Guardar Producto</span>
              </button>
            </form>
          </div>

          {/* Lista editable de precios y disponibilidad */}
          <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 lg:col-span-7">
            <h3 className="font-display text-lg font-bold text-white mb-4">
              Catálogo Vigente ({state.products.length} productos · Precios editables)
            </h3>
            <div className="max-h-[620px] space-y-2.5 overflow-y-auto pr-1">
              {state.products.map((prod) => {
                const cat = categoryMap.get(prod.categoryId);
                const estCost = recipeMap.get(prod.id)?.estimatedCost ?? 0;
                return (
                  <div
                    key={prod.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#262626] bg-[#121212] p-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white">
                        {prod.name}{' '}
                        <span className="text-xs font-normal text-neutral-400">· {cat?.name}</span>
                      </p>
                      <p className="text-xs text-neutral-400 truncate">{prod.description}</p>
                      <p className="mt-1 text-xs">
                        <span className={prod.isAvailable ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
                          {prod.isAvailable ? 'Disponible' : 'No disponible'}
                        </span>
                        {estCost > 0 && (
                          <span className="text-neutral-400"> · Costo receta: S/ {estCost.toFixed(2)}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-lg font-extrabold text-[#FFD600] tabular-nums">
                        S/ {prod.price.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProduct(prod);
                          setEditPrice(prod.price.toFixed(2));
                          setEditAvail(prod.isAvailable);
                        }}
                        className="flex h-10 items-center gap-1 rounded-lg border border-[#2E2E2E] bg-[#1C1C1C] px-3 text-xs font-bold text-white hover:border-[#FFD600]"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Editar</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 2: INVENTARIO AUTOMÁTICO, RECETAS REALES Y MERMAS */}
      {subTab === 'INVENTARIO' && (
        <div className="space-y-6">
          {lowStockIngredients.length > 0 && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-amber-300">
                  Alerta de stock bajo ({lowStockIngredients.length} ingredientes)
                </p>
                <p className="mt-0.5 text-xs text-amber-200/80">
                  {lowStockIngredients.map((i) => `${i.name} (${i.currentStock} ${i.unit})`).join(' · ')}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Configurar Receta Real de un Plato */}
            <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-4 lg:col-span-6">
              <div>
                <h3 className="font-display text-lg font-bold text-white">Configurar Receta Real por Plato</h3>
                <p className="text-xs text-neutral-400">
                  Introduce las cantidades reales utilizadas en tu cocina. Al iniciar preparación en KDS, el stock se descontará automáticamente.
                </p>
              </div>

              <select
                value={recipeProductId}
                onChange={(e) => loadRecipeForProduct(e.target.value)}
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm font-bold text-white"
              >
                {state.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (Venta: S/ {p.price.toFixed(2)})
                  </option>
                ))}
              </select>

              <div className="space-y-2">
                {recipeDraft.map((row, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select
                      value={row.ingredientId}
                      onChange={(e) =>
                        setRecipeDraft((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, ingredientId: e.target.value } : r))
                        )
                      }
                      className="h-10 flex-1 rounded-xl border border-[#2E2E2E] bg-[#111111] px-2.5 text-xs text-white"
                    >
                      {state.ingredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name} ({ing.unit})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={row.quantity}
                      onChange={(e) =>
                        setRecipeDraft((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r))
                        )
                      }
                      placeholder="Cant."
                      className="h-10 w-24 rounded-xl border border-[#2E2E2E] bg-[#111111] px-2.5 font-mono text-xs text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setRecipeDraft((prev) => prev.filter((_, i) => i !== idx))}
                      className="rounded-xl bg-[#262626] px-3 text-xs font-bold text-red-400"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setRecipeDraft((prev) => [
                      ...prev,
                      { ingredientId: state.ingredients[0]?.id ?? '', quantity: '' },
                    ])
                  }
                  className="min-h-[40px] rounded-xl border border-[#2E2E2E] bg-[#121212] px-3.5 text-xs font-bold text-[#FFD600]"
                >
                  + Añadir Ingrediente
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onApiAction(
                      'POST',
                      `/api/recipes/${recipeProductId}`,
                      {
                        items: recipeDraft.map((d) => ({
                          ingredientId: d.ingredientId,
                          quantity: Number.parseFloat(d.quantity) || 0,
                        })),
                      },
                      'Guardar receta'
                    );
                  }}
                  className="min-h-[40px] flex-1 rounded-xl bg-[#FFD600] px-4 text-xs font-extrabold text-[#111111]"
                >
                  Guardar Receta y Calcular Costo
                </button>
              </div>
              {recipeMap.get(recipeProductId) && (
                <p className="font-mono text-xs text-emerald-400">
                  Costo estimado actual de preparación: S/ {recipeMap.get(recipeProductId)!.estimatedCost.toFixed(2)}
                </p>
              )}
            </div>

            {/* Nuevo Ingrediente + Mermas/Ajustes */}
            <div className="space-y-6 lg:col-span-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await onApiAction(
                    'POST',
                    '/api/ingredients',
                    {
                      category: ingCat,
                      name: ingName,
                      unit: ingUnit,
                      minStock: Number.parseFloat(ingMin) || 0,
                      expirationDate: ingExp || null,
                    },
                    `Nuevo ingrediente ${ingName}`
                  );
                  if (ok) setIngName('');
                }}
                className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-3"
              >
                <h3 className="font-display text-base font-bold text-white">Agregar Ingrediente al Inventario</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select
                    value={ingCat}
                    onChange={(e) => setIngCat(e.target.value)}
                    className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                  >
                    {INGREDIENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <select
                    value={ingUnit}
                    onChange={(e) => setIngUnit(e.target.value as Ingredient['unit'])}
                    className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                  >
                    <option value="kg">Kilogramos (kg)</option>
                    <option value="g">Gramos (g)</option>
                    <option value="l">Litros (l)</option>
                    <option value="ml">Mililitros (ml)</option>
                    <option value="unidad">Unidades (unidad)</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    type="text"
                    required
                    value={ingName}
                    onChange={(e) => setIngName(e.target.value)}
                    placeholder="Nombre ingrediente"
                    className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white sm:col-span-2"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={ingMin}
                    onChange={(e) => setIngMin(e.target.value)}
                    placeholder="Stock mín."
                    className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-xs text-white"
                  />
                </div>
                <input
                  type="date"
                  value={ingExp}
                  onChange={(e) => setIngExp(e.target.value)}
                  className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                />
                <button
                  type="submit"
                  className="min-h-[42px] w-full rounded-xl bg-[#E31B23] text-xs font-extrabold text-white"
                >
                  Registrar Ingrediente
                </button>
              </form>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const ok = await onApiAction(
                    'POST',
                    '/api/inventory/adjust',
                    {
                      ingredientId: adjIngId,
                      movementType: adjType,
                      quantity: Number.parseFloat(adjQty) || 0,
                      reason: adjReason,
                    },
                    `Movimiento ${adjType}`
                  );
                  if (ok) {
                    setAdjQty('');
                    setAdjReason('');
                  }
                }}
                className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-3"
              >
                <h3 className="font-display text-base font-bold text-white">Registrar Merma, Ajuste o Devolución</h3>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={adjIngId}
                    onChange={(e) => setAdjIngId(e.target.value)}
                    className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                  >
                    {state.ingredients.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.unit})
                      </option>
                    ))}
                  </select>
                  <select
                    value={adjType}
                    onChange={(e) => setAdjType(e.target.value as typeof adjType)}
                    className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                  >
                    <option value="MERMA">Merma / Desperdicio</option>
                    <option value="AJUSTE">Ajuste de Conteo (+/-)</option>
                    <option value="DEVOLUCION">Devolución a Stock</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={adjQty}
                    onChange={(e) => setAdjQty(e.target.value)}
                    placeholder="Cantidad"
                    className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-xs text-white"
                  />
                  <input
                    type="text"
                    required
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    placeholder="Motivo"
                    className="h-11 col-span-2 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="min-h-[42px] w-full rounded-xl border border-[#2E2E2E] bg-[#242424] text-xs font-extrabold text-white hover:border-[#FFD600]"
                >
                  Aplicar Movimiento
                </button>
              </form>
            </div>
          </div>

          {/* Tabla de Stock Actual e Historial */}
          <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 overflow-x-auto">
            <h3 className="font-display text-lg font-bold text-white mb-3 flex items-center gap-2">
              <Package className="h-5 w-5 text-[#FFD600]" />
              <span>Stock Actual de Ingredientes</span>
            </h3>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#262626] text-neutral-400">
                <tr>
                  <th className="py-2 pr-4">Categoría</th>
                  <th className="py-2 pr-4">Ingrediente</th>
                  <th className="py-2 pr-4 text-right">Stock Actual</th>
                  <th className="py-2 pr-4 text-right">Mínimo</th>
                  <th className="py-2 pr-4 text-right">Costo Prom. Unit.</th>
                  <th className="py-2 text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222222]">
                {state.ingredients.map((i) => {
                  const low = i.currentStock <= i.minStock;
                  return (
                    <tr key={i.id}>
                      <td className="py-2.5 pr-4 text-neutral-400">{i.category}</td>
                      <td className="py-2.5 pr-4 font-bold text-white">{i.name}</td>
                      <td className="py-2.5 pr-4 text-right font-mono font-bold tabular-nums">
                        {i.currentStock.toFixed(2)} {i.unit}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-neutral-400 tabular-nums">
                        {i.minStock} {i.unit}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-[#FFD600] tabular-nums">
                        S/ {i.averageUnitCost.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right font-bold">
                        <span className={low ? 'text-amber-400' : 'text-emerald-400'}>
                          {low ? 'Stock Bajo' : 'Normal'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBTAB 3: MÓDULO DE COMPRAS Y PROVEEDORES */}
      {subTab === 'COMPRAS' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-5">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onApiAction(
                  'POST',
                  '/api/purchases',
                  {
                    supplierId: purSupId || state.suppliers[0]?.id,
                    ingredientId: purIngId || state.ingredients[0]?.id,
                    quantity: Number.parseFloat(purQty) || 0,
                    unitPrice: Number.parseFloat(purUnitPrice) || 0,
                  },
                  'Compra de ingrediente'
                );
                if (ok) {
                  setPurQty('');
                  setPurUnitPrice('');
                }
              }}
              className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-3"
            >
              <h3 className="font-display text-lg font-bold text-white">Registrar Compra de Insumos</h3>
              <p className="text-xs text-neutral-400">
                Incrementa el inventario automáticamente y recalcula el costo promedio ponderado.
              </p>
              <select
                value={purSupId}
                onChange={(e) => setPurSupId(e.target.value)}
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              >
                {state.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                value={purIngId}
                onChange={(e) => setPurIngId(e.target.value)}
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              >
                {state.ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.unit})
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={purQty}
                  onChange={(e) => setPurQty(e.target.value)}
                  placeholder="Cantidad"
                  className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-sm text-white"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={purUnitPrice}
                  onChange={(e) => setPurUnitPrice(e.target.value)}
                  placeholder="Precio unit. S/"
                  className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-sm text-white"
                />
              </div>
              <p className="font-mono text-sm font-bold text-[#FFD600] tabular-nums">
                Importe total: S/ {((Number.parseFloat(purQty) || 0) * (Number.parseFloat(purUnitPrice) || 0)).toFixed(2)}
              </p>
              <button
                type="submit"
                className="min-h-[46px] w-full rounded-xl bg-[#FFD600] text-xs font-extrabold text-[#111111]"
              >
                Confirmar Compra e Ingresar al Inventario
              </button>
            </form>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onApiAction(
                  'POST',
                  '/api/suppliers',
                  { name: supName, phone: supPhone },
                  `Nuevo proveedor ${supName}`
                );
                if (ok) {
                  setSupName('');
                  setSupPhone('');
                }
              }}
              className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-3"
            >
              <h3 className="font-display text-base font-bold text-white">Nuevo Proveedor</h3>
              <input
                type="text"
                required
                value={supName}
                onChange={(e) => setSupName(e.target.value)}
                placeholder="Nombre o razón social"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              />
              <input
                type="text"
                value={supPhone}
                onChange={(e) => setSupPhone(e.target.value)}
                placeholder="Teléfono / WhatsApp"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              />
              <button
                type="submit"
                className="min-h-[42px] w-full rounded-xl border border-[#2E2E2E] bg-[#242424] text-xs font-bold text-white"
              >
                Agregar Proveedor
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 lg:col-span-7 overflow-x-auto">
            <h3 className="font-display text-lg font-bold text-white mb-4">
              Historial de Compras e Historial de Precios ({state.purchases.length})
            </h3>
            {state.purchases.length === 0 ? (
              <p className="text-sm text-neutral-400">Aún no se han registrado compras de insumos.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#262626] text-neutral-400">
                  <tr>
                    <th className="py-2 pr-3">Fecha</th>
                    <th className="py-2 pr-3">Proveedor</th>
                    <th className="py-2 pr-3">Ingrediente</th>
                    <th className="py-2 pr-3 text-right">Cantidad</th>
                    <th className="py-2 pr-3 text-right">P. Unit</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222222]">
                  {state.purchases.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2.5 pr-3 text-neutral-400">
                        {new Date(p.purchasedAt).toLocaleDateString('es-PE')}
                      </td>
                      <td className="py-2.5 pr-3 text-neutral-200">{p.supplierName}</td>
                      <td className="py-2.5 pr-3 font-bold text-white">{p.ingredientName}</td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                        {p.quantity} {p.unit}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">S/ {p.unitPrice.toFixed(2)}</td>
                      <td className="py-2.5 text-right font-mono font-bold text-[#FFD600] tabular-nums">
                        S/ {p.totalAmount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* SUBTAB 4: REPORTES GERENCIALES Y EXPORTACIÓN EXCEL / PDF */}
      {subTab === 'REPORTES' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#2A2A2A] bg-[#181818] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <label className="block text-[11px] text-neutral-400">Desde</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-10 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] text-neutral-400">Hasta</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-10 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => exportReportsExcel(state, fromDate, toDate)}
                className="flex min-h-[42px] items-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-extrabold text-white hover:bg-emerald-500"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>Exportar Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  exportReportsPdf(
                    {
                      totalSales: reportData.totalSales,
                      totalEstimatedCost: reportData.totalEstimatedCost,
                      grossProfit: reportData.grossProfit,
                      totalPurchases: reportData.totalPurchases,
                      totalWasteLoss: reportData.totalWasteLoss,
                      byMethod: reportData.byMethod,
                      topProducts: reportData.topProducts,
                    },
                    fromDate,
                    toDate
                  )
                }
                className="flex min-h-[42px] items-center gap-2 rounded-xl bg-[#E31B23] px-4 text-xs font-extrabold text-white hover:bg-[#c8161d]"
              >
                <FileText className="h-4 w-4" />
                <span>Exportar PDF</span>
              </button>
            </div>
          </div>

          {/* KPIs financieros */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: 'Ventas Cobradas', value: `S/ ${reportData.totalSales.toFixed(2)}`, color: 'text-[#FFD600]' },
              { label: 'Costos Estimados', value: `S/ ${reportData.totalEstimatedCost.toFixed(2)}`, color: 'text-white' },
              { label: 'Ganancia Bruta Est.', value: `S/ ${reportData.grossProfit.toFixed(2)}`, color: 'text-emerald-400' },
              { label: 'Compras de Insumos', value: `S/ ${reportData.totalPurchases.toFixed(2)}`, color: 'text-sky-300' },
              { label: 'Pérdida por Mermas', value: `S/ ${reportData.totalWasteLoss.toFixed(2)}`, color: 'text-red-400' },
            ].map((k) => (
              <div key={k.label} className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-4">
                <p className="text-xs text-neutral-400">{k.label}</p>
                <p className={`mt-1 font-mono text-xl font-extrabold tabular-nums ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Por producto */}
            <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
              <h4 className="font-display text-base font-bold text-white mb-3">Ventas y Margen por Producto</h4>
              {reportData.topProducts.length === 0 ? (
                <p className="text-xs text-neutral-400">Sin ventas en el rango seleccionado.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {reportData.topProducts.map((p) => (
                    <div key={p.name} className="flex justify-between border-b border-[#242424] pb-1.5">
                      <span className="text-neutral-200">
                        <strong className="text-white">{p.qty}x</strong> {p.name}
                      </span>
                      <span className="font-mono text-[#FFD600] tabular-nums">
                        S/ {p.revenue.toFixed(2)} (Costo S/ {p.estCost.toFixed(2)})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Métodos de pago, Mozos y Categorías */}
            <div className="space-y-6">
              <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
                <h4 className="font-display text-base font-bold text-white mb-3">Métodos de Pago y Categorías</h4>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1.5">
                    <p className="font-semibold text-neutral-400">Por Método</p>
                    {reportData.byMethod.map((m) => (
                      <div key={m.method} className="flex justify-between">
                        <span>{m.method}</span>
                        <span className="font-mono font-bold tabular-nums">S/ {m.total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-semibold text-neutral-400">Por Categoría</p>
                    {reportData.byCategory.map(([cat, total]) => (
                      <div key={cat} className="flex justify-between">
                        <span>{cat}</span>
                        <span className="font-mono font-bold tabular-nums">S/ {total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
                <h4 className="font-display text-base font-bold text-white mb-3">Ventas por Mozo y Consumo</h4>
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1.5">
                    <p className="font-semibold text-neutral-400">Mozos</p>
                    {reportData.byWaiter.map((w) => (
                      <div key={w.name} className="flex justify-between">
                        <span>{w.name} ({w.orders})</span>
                        <span className="font-mono font-bold tabular-nums">S/ {w.total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-semibold text-neutral-400">Consumo Ingredientes</p>
                    {reportData.consumption.map((c) => (
                      <div key={c.name} className="flex justify-between">
                        <span>{c.name}</span>
                        <span className="font-mono font-bold tabular-nums">
                          {c.qty.toFixed(2)} {c.unit}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUBTAB 5: USUARIOS, MESAS, AUDITORÍA Y RESPALDO */}
      {subTab === 'SEGURIDAD' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-6 lg:col-span-5">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const passToUse = newUserPass.trim() || '1111';
                const ok = await onApiAction(
                  'POST',
                  '/api/users',
                  { fullName: newUserFull, username: newUserName, password: passToUse, roleId: newUserRoleId },
                  `Nuevo usuario ${newUserName}`
                );
                if (ok) {
                  setNewUserFull('');
                  setNewUserName('');
                  setNewUserPass('1111');
                }
              }}
              className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-3"
            >
              <div>
                <h3 className="font-display text-base font-bold text-white">Agregar Mozos y Personal</h3>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Registra un usuario individual para cada mozo (Ej: mozo2, mozo3) para que accedan desde su celular y queden registrados en sus comandas.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {state.roles.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setNewUserRoleId(r.id)}
                    className={`min-h-[36px] rounded-lg border px-2 text-[11px] font-bold transition-colors ${
                      newUserRoleId === r.id
                        ? 'border-[#FFD600] bg-[#FFD600] text-[#111111]'
                        : 'border-[#2E2E2E] bg-[#111111] text-neutral-300 hover:border-neutral-600'
                    }`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
              <input
                type="text"
                required
                value={newUserFull}
                onChange={(e) => setNewUserFull(e.target.value)}
                placeholder="Nombre completo (Ej: Ana Torres)"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  placeholder="Usuario (Ej: mozo2)"
                  className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
                />
                <input
                  type="password"
                  minLength={4}
                  value={newUserPass}
                  onChange={(e) => setNewUserPass(e.target.value)}
                  placeholder="Contraseña (defecto: 1111)"
                  className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
                />
              </div>
              <button
                type="submit"
                className="min-h-[44px] w-full rounded-xl bg-[#FFD600] text-xs font-extrabold text-[#111111]"
              >
                Registrar Personal ({state.roles.find((r) => r.id === newUserRoleId)?.name ?? 'MOZO'})
              </button>
            </form>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onApiAction(
                  'POST',
                  '/api/tables',
                  { number: Number.parseInt(newTableNum, 10) },
                  `Nueva mesa ${newTableNum}`
                );
                if (ok) setNewTableNum('');
              }}
              className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-3"
            >
              <h3 className="font-display text-base font-bold text-white">
                Agregar Mesa Configurable ({state.tables.length})
              </h3>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1"
                  required
                  value={newTableNum}
                  onChange={(e) => setNewTableNum(e.target.value)}
                  placeholder="Número de mesa (Ej: 11)"
                  className="h-11 flex-1 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
                />
                <button
                  type="submit"
                  className="min-h-[44px] rounded-xl bg-[#E31B23] px-4 text-xs font-extrabold text-white"
                >
                  Agregar
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1.5 pt-1 sm:grid-cols-5">
                {state.tables.map((t) => (
                  <div
                    key={t.id}
                    className={`rounded-lg border px-2 py-1.5 text-center text-[11px] font-bold ${
                      t.status === 'LIBRE'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : 'border-[#E31B23]/50 bg-[#E31B23]/10 text-red-300'
                    }`}
                  >
                    <p className="truncate text-white">{t.label}</p>
                    <p className="text-[10px]">
                      {t.status === 'LIBRE' ? 'Disponible' : t.status === 'PENDIENTE_PAGO' ? 'Por pagar' : 'Ocupada'}
                    </p>
                  </div>
                ))}
              </div>
            </form>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await onApiAction(
                  'PATCH',
                  '/api/settings/app-gate',
                  {
                    username: gateEditUser.trim() || undefined,
                    password: gateEditPass.trim() || undefined,
                  },
                  'Actualizar acceso general al aplicativo'
                );
                if (ok) {
                  setGateEditUser('');
                  setGateEditPass('');
                }
              }}
              className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-3"
            >
              <div>
                <h3 className="font-display text-base font-bold text-white">
                  Acceso General al Aplicativo
                </h3>
                <p className="mt-0.5 text-xs text-neutral-400">
                  Clave solicitada antes de mostrar la lista de trabajadores (solo el Administrador puede cambiarla).
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={gateEditUser}
                  onChange={(e) => setGateEditUser(e.target.value)}
                  placeholder="Nuevo usuario general (opcional)"
                  className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                />
                <input
                  type="password"
                  minLength={4}
                  value={gateEditPass}
                  onChange={(e) => setGateEditPass(e.target.value)}
                  placeholder="Nueva clave general (mín. 4)"
                  className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white"
                />
              </div>
              <button
                type="submit"
                disabled={!gateEditUser.trim() && !gateEditPass.trim()}
                className="min-h-[42px] w-full rounded-xl border border-[#FFD600]/60 bg-[#1F1C10] text-xs font-extrabold text-[#FFD600] hover:bg-[#FFD600] hover:text-[#111111] disabled:opacity-40"
              >
                Actualizar Clave General
              </button>
            </form>

            <button
              type="button"
              onClick={handleDownloadBackup}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-[#2E2E2E] bg-[#181818] text-xs font-bold text-[#FFD600] hover:border-[#FFD600]"
            >
              <Download className="h-4 w-4" />
              <span>Descargar Copia de Seguridad Completa (JSON)</span>
            </button>
          </div>

          <div className="space-y-6 lg:col-span-7">
            <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold text-white">
                  Personal Registrado ({state.users.length})
                </h3>
                <span className="text-xs text-neutral-400 tabular-nums">
                  Mozos activos:{' '}
                  <strong className="text-[#FFD600]">
                    {state.users.filter((u) => u.roleName === 'MOZO' && u.isActive).length}
                  </strong>
                </span>
              </div>
              <div className="space-y-2">
                {state.users.map((u) => (
                  <div
                    key={u.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#262626] bg-[#121212] px-3.5 py-2.5 text-xs"
                  >
                    <div>
                      <p className="font-bold text-white">
                        {u.fullName} <span className="text-neutral-400">(@{u.username})</span>
                      </p>
                      <p className="text-[#FFD600] font-semibold">{u.roleName}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUser(u);
                          setEditUserFullName(u.fullName);
                          setEditUserRoleId(u.roleId);
                          setEditUserPassword('');
                        }}
                        className="flex items-center gap-1 rounded-lg border border-[#2E2E2E] bg-[#1C1C1C] px-2.5 py-1.5 font-bold text-white hover:border-[#FFD600]"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Editar / Clave</span>
                      </button>
                      <button
                        type="button"
                        disabled={u.id === currentUser.id}
                        onClick={() =>
                          onApiAction(
                            'PATCH',
                            `/api/users/${u.id}`,
                            { isActive: !u.isActive },
                            `${u.isActive ? 'Desactivar' : 'Activar'} usuario ${u.username}`
                          )
                        }
                        className={`rounded-lg px-2.5 py-1.5 font-bold disabled:opacity-40 ${
                          u.isActive ? 'bg-emerald-600/20 text-emerald-400' : 'bg-amber-600/20 text-amber-300'
                        }`}
                      >
                        {u.isActive ? 'Activo' : 'Inactivo'}
                      </button>
                      {u.id !== currentUser.id &&
                        (confirmDeleteUserId === u.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                await onApiAction('DELETE', `/api/users/${u.id}`, undefined, `Eliminar ${u.fullName}`);
                                setConfirmDeleteUserId(null);
                              }}
                              className="rounded-lg bg-[#E31B23] px-2.5 py-1.5 font-bold text-white"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteUserId(null)}
                              className="rounded-lg bg-[#262626] px-2 py-1.5 text-neutral-300"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteUserId(u.id)}
                            className="flex items-center gap-1 rounded-lg bg-[#E31B23]/20 px-2.5 py-1.5 font-bold text-red-400 hover:bg-[#E31B23] hover:text-white"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Eliminar</span>
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
              <h3 className="font-display text-base font-bold text-white mb-3">
                Registro de Auditoría ({state.auditLogs.length})
              </h3>
              <div className="max-h-72 space-y-1.5 overflow-y-auto text-xs">
                {state.auditLogs.slice(0, 40).map((log) => (
                  <div key={log.id} className="flex justify-between gap-2 border-b border-[#242424] py-1.5">
                    <div>
                      <span className="font-bold text-[#FFD600]">{log.action}</span>{' '}
                      <span className="text-neutral-300">por {log.userName}</span>
                      <span className="block text-[11px] text-neutral-500 truncate max-w-md">{log.detailsJson}</span>
                    </div>
                    <span className="font-mono text-[11px] text-neutral-400 shrink-0">
                      {new Date(log.createdAt).toLocaleTimeString('es-PE')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Precio y Disponibilidad de Producto */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await onApiAction(
                'PATCH',
                `/api/products/${editingProduct.id}`,
                { price: Number.parseFloat(editPrice) || 0, isAvailable: editAvail },
                `Editar ${editingProduct.name}`
              );
              if (ok) setEditingProduct(null);
            }}
            className="w-full max-w-sm rounded-2xl border border-[#2E2E2E] bg-[#161616] p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-extrabold text-white">{editingProduct.name}</h3>
            <div>
              <label className="mb-1 block text-xs text-neutral-300">Precio de Venta (S/)</label>
              <input
                type="number"
                step="0.10"
                min="0"
                required
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value)}
                className="h-12 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-lg font-bold text-[#FFD600]"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={editAvail}
                onChange={(e) => setEditAvail(e.target.checked)}
                className="h-4 w-4 accent-[#FFD600]"
              />
              <span>Disponible en carta</span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="min-h-[42px] rounded-xl px-4 text-xs font-bold text-neutral-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[#FFD600] px-5 text-xs font-extrabold text-[#111111]"
              >
                Guardar Cambios
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Editar Usuario / Mozo */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const newPassPlain = editUserPassword.trim();
              const ok = await onApiAction(
                'PATCH',
                `/api/users/${editingUser.id}`,
                {
                  fullName: editUserFullName,
                  roleId: editUserRoleId,
                  password: newPassPlain || undefined,
                },
                `Actualizar ${editingUser.username}`
              );
              if (ok) {
                setEditingUser(null);
              }
            }}
            className="w-full max-w-sm rounded-2xl border border-[#2E2E2E] bg-[#161616] p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-extrabold text-white">
              Editar Personal (@{editingUser.username})
            </h3>
            <div>
              <label className="mb-1 block text-xs text-neutral-300">Nombre completo</label>
              <input
                type="text"
                required
                value={editUserFullName}
                onChange={(e) => setEditUserFullName(e.target.value)}
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-300">Rol</label>
              <select
                value={editUserRoleId}
                onChange={(e) => setEditUserRoleId(e.target.value)}
                disabled={editingUser.id === currentUser.id}
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white disabled:opacity-50"
              >
                {state.roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-300">
                Nueva contraseña (dejar vacío para mantener)
              </label>
              <input
                type="password"
                minLength={4}
                value={editUserPassword}
                onChange={(e) => setEditUserPassword(e.target.value)}
                placeholder="••••••"
                className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="min-h-[42px] rounded-xl px-4 text-xs font-bold text-neutral-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[#FFD600] px-5 text-xs font-extrabold text-[#111111]"
              >
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
