import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  ChefHat,
  Clock,
  Plus,
  ShoppingBag,
  Trash2,
  Utensils,
  XCircle,
} from 'lucide-react';
import type {
  PosBootstrapState,
  ReservationMode,
  ReservationStatus,
} from '../types/pos';

interface ReservationManagerPanelProps {
  state: PosBootstrapState;
  preselectedTableId?: string;
  onApiAction: (
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body: unknown,
    description: string
  ) => Promise<unknown>;
}

const STATUS_BADGE: Record<ReservationStatus, { label: string; cls: string }> = {
  PENDIENTE: {
    label: 'Programada',
    cls: 'border-[#FFD600]/50 bg-[#FFD600]/15 text-[#FFD600]',
  },
  EN_PREPARACION: {
    label: 'Alistando / En mesa',
    cls: 'border-sky-400/50 bg-sky-500/15 text-sky-300',
  },
  COMPLETADA: {
    label: 'Completada',
    cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
  },
  CANCELADA: {
    label: 'Cancelada',
    cls: 'border-red-500/40 bg-red-500/15 text-red-400',
  },
};

function getLocalDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDefaultStartTime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 30);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = d.getMinutes() < 30 ? '00' : '30';
  return `${hh}:${mm}`;
}

function calcEndTime(startTime: string, durationHours: number): string {
  const [hhStr, mmStr] = startTime.split(':');
  const startMin = (Number.parseInt(hhStr, 10) || 0) * 60 + (Number.parseInt(mmStr, 10) || 0);
  const totalMin = Math.min(23 * 60 + 59, startMin + Math.round(durationHours * 60));
  return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
}

export function ReservationManagerPanel({
  state,
  preselectedTableId,
  onApiAction,
}: ReservationManagerPanelProps) {
  const [serviceMode, setServiceMode] = useState<ReservationMode>('EN_MESA');
  const [tableId, setTableId] = useState<string>(preselectedTableId || state.tables[0]?.id || '');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [reservationDate, setReservationDate] = useState(getLocalDateStr);
  const [startTime, setStartTime] = useState(getDefaultStartTime);
  const [durationHours, setDurationHours] = useState<number>(2);
  const [notes, setNotes] = useState('');
  const [filterMode, setFilterMode] = useState<'ACTIVAS' | 'TODAS'>('ACTIVAS');

  // Platos opcionales para alistar comida
  const [pickedProductId, setPickedProductId] = useState(state.products[0]?.id ?? '');
  const [pickedQty, setPickedQty] = useState('1');
  const [preOrderItems, setPreOrderItems] = useState<
    Array<{ productId: string; productName: string; quantity: number }>
  >([]);

  useEffect(() => {
    if (preselectedTableId) {
      setTableId(preselectedTableId);
      setServiceMode('EN_MESA');
    }
  }, [preselectedTableId]);

  const computedEndTime = useMemo(
    () => calcEndTime(startTime, durationHours),
    [startTime, durationHours]
  );

  const visibleReservations = useMemo(() => {
    return state.reservations.filter((r) => {
      if (filterMode === 'ACTIVAS') {
        return r.status === 'PENDIENTE' || r.status === 'EN_PREPARACION';
      }
      return true;
    });
  }, [state.reservations, filterMode]);

  const handleAddPreItem = () => {
    const prod = state.products.find((p) => p.id === (pickedProductId || state.products[0]?.id));
    const qty = Math.max(1, Number.parseInt(pickedQty, 10) || 1);
    if (!prod) return;
    setPreOrderItems((prev) => {
      const idx = prev.findIndex((i) => i.productId === prod.id);
      if (idx >= 0) {
        return prev.map((it, i) => (i === idx ? { ...it, quantity: it.quantity + qty } : it));
      }
      return [...prev, { productId: prod.id, productName: prod.name, quantity: qty }];
    });
    setPickedQty('1');
  };

  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await onApiAction(
      'POST',
      '/api/reservations',
      {
        tableId: serviceMode === 'EN_MESA' ? tableId : tableId || null,
        customerName,
        customerPhone: customerPhone.trim() || null,
        serviceMode,
        reservationDate,
        startTime,
        durationHours,
        notes,
        preOrderItems,
      },
      `Reserva por horas (${customerName})`
    );
    if (ok) {
      setCustomerName('');
      setCustomerPhone('');
      setNotes('');
      setPreOrderItems([]);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Formulario de Nueva Reserva por Horas */}
      <form
        onSubmit={handleCreateReservation}
        className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-4 lg:col-span-5"
      >
        <div>
          <h3 className="font-display text-lg font-extrabold text-white flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-[#FFD600]" />
            <span>Reservar Mesa por Horas</span>
          </h3>
          <p className="mt-0.5 text-xs text-neutral-400">
            Reserva una mesa por horas para servirse en salón o programa comida para alistar y llevar.
          </p>
        </div>

        {/* Modalidad */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setServiceMode('EN_MESA');
              if (!tableId && state.tables[0]) setTableId(state.tables[0].id);
            }}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-extrabold transition-colors ${
              serviceMode === 'EN_MESA'
                ? 'border-[#FFD600] bg-[#FFD600] text-[#111111]'
                : 'border-[#2E2E2E] bg-[#111111] text-neutral-300'
            }`}
          >
            <Utensils className="h-4 w-4 shrink-0" />
            <span>Servirse en Mesa</span>
          </button>
          <button
            type="button"
            onClick={() => setServiceMode('PARA_LLEVAR')}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-extrabold transition-colors ${
              serviceMode === 'PARA_LLEVAR'
                ? 'border-[#E31B23] bg-[#E31B23] text-white'
                : 'border-[#2E2E2E] bg-[#111111] text-neutral-300'
            }`}
          >
            <ShoppingBag className="h-4 w-4 shrink-0" />
            <span>Alistar Para Llevar</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-neutral-300">
              {serviceMode === 'EN_MESA' ? 'Mesa a reservar' : 'Mesa de referencia (opcional)'}
            </label>
            <select
              value={tableId}
              required={serviceMode === 'EN_MESA'}
              onChange={(e) => setTableId(e.target.value)}
              className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
            >
              {serviceMode === 'PARA_LLEVAR' && (
                <option value="">Sin mesa fija (Mostrador / Para llevar)</option>
              )}
              {state.tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} ({t.status === 'LIBRE' ? 'Disponible' : t.status.replace('_', ' ')})
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            required
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Nombre del cliente"
            className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white placeholder-neutral-500"
          />
          <input
            type="text"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="Teléfono / WhatsApp"
            className="h-11 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white placeholder-neutral-500"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-neutral-400">Fecha</label>
            <input
              type="date"
              required
              value={reservationDate}
              onChange={(e) => setReservationDate(e.target.value)}
              className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-2.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-neutral-400">Hora inicio</label>
            <input
              type="time"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-2.5 text-xs text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-neutral-400">Duración</label>
            <select
              value={durationHours}
              onChange={(e) => setDurationHours(Number.parseFloat(e.target.value))}
              className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-2.5 text-xs font-bold text-[#FFD600]"
            >
              {[0.5, 1, 1.5, 2, 3, 4, 6].map((h) => (
                <option key={h} value={h}>
                  {h === 0.5 ? '30 min' : `${h} hora${h > 1 ? 's' : ''}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-[#262626] bg-[#121212] px-3.5 py-2 text-xs">
          <span className="text-neutral-400">Horario reservado:</span>
          <span className="font-mono font-extrabold text-[#FFD600] tabular-nums">
            {startTime} – {computedEndTime} ({durationHours}h)
          </span>
        </div>

        {/* Platos opcionales para alistar */}
        <div className="rounded-xl border border-[#262626] bg-[#121212] p-3 space-y-2.5">
          <p className="text-xs font-bold text-neutral-200">
            Platos a alistar (opcional — ideal para llevar o pedido anticipado)
          </p>
          <div className="flex gap-2">
            <select
              value={pickedProductId}
              onChange={(e) => setPickedProductId(e.target.value)}
              className="h-10 flex-1 rounded-lg border border-[#2E2E2E] bg-[#181818] px-2.5 text-xs text-white"
            >
              {state.products
                .filter((p) => p.isAvailable)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (S/ {p.price.toFixed(2)})
                  </option>
                ))}
            </select>
            <input
              type="number"
              min="1"
              value={pickedQty}
              onChange={(e) => setPickedQty(e.target.value)}
              className="h-10 w-16 rounded-lg border border-[#2E2E2E] bg-[#181818] px-2 text-center font-mono text-xs text-white"
            />
            <button
              type="button"
              onClick={handleAddPreItem}
              className="flex h-10 items-center gap-1 rounded-lg bg-[#262626] px-3 text-xs font-bold text-[#FFD600] hover:bg-[#333333]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Añadir</span>
            </button>
          </div>

          {preOrderItems.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {preOrderItems.map((it) => (
                <div
                  key={it.productId}
                  className="flex items-center justify-between rounded-lg bg-[#1A1A1A] px-2.5 py-1.5 text-xs"
                >
                  <span className="text-white">
                    <strong className="text-[#FFD600]">{it.quantity}x</strong> {it.productName}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPreOrderItems((prev) => prev.filter((x) => x.productId !== it.productId))
                    }
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas (Ej: Alistar cremas aparte, recoge a las 7pm)"
          className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-xs text-white placeholder-neutral-500"
        />

        <button
          type="submit"
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-4 text-sm font-extrabold text-[#111111] hover:bg-[#f2ca00]"
        >
          <CalendarClock className="h-4 w-4" />
          <span>Registrar Reserva</span>
        </button>
      </form>

      {/* Lista de Reservas */}
      <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 space-y-4 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-lg font-extrabold text-white">
            Reservas Programadas ({visibleReservations.length})
          </h3>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setFilterMode('ACTIVAS')}
              className={`min-h-[36px] rounded-lg px-3 text-xs font-bold ${
                filterMode === 'ACTIVAS'
                  ? 'bg-[#FFD600] text-[#111111]'
                  : 'bg-[#121212] text-neutral-300'
              }`}
            >
              Activas
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('TODAS')}
              className={`min-h-[36px] rounded-lg px-3 text-xs font-bold ${
                filterMode === 'TODAS'
                  ? 'bg-[#FFD600] text-[#111111]'
                  : 'bg-[#121212] text-neutral-300'
              }`}
            >
              Historial Completo
            </button>
          </div>
        </div>

        {visibleReservations.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-[#242424] bg-[#121212] p-8 text-center text-neutral-400">
            <Clock className="mb-2 h-9 w-9 text-neutral-600" />
            <p className="text-sm font-semibold text-white">No hay reservas en esta vista</p>
            <p className="mt-1 text-xs">
              Crea una reserva por horas para salón o para alistar comida para llevar desde el formulario.
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
            {visibleReservations.map((r) => {
              const badge = STATUS_BADGE[r.status];
              const isActive = r.status === 'PENDIENTE' || r.status === 'EN_PREPARACION';
              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-[#262626] bg-[#121212] p-4 space-y-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-base font-extrabold text-white">
                          {r.tableLabel ?? 'Mostrador / Para Llevar'}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold ${
                            r.serviceMode === 'PARA_LLEVAR'
                              ? 'bg-[#E31B23]/20 text-red-300'
                              : 'bg-sky-500/15 text-sky-300'
                          }`}
                        >
                          {r.serviceMode === 'PARA_LLEVAR' ? 'Alistar Para Llevar' : 'En Mesa'}
                        </span>
                        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-300">
                        Cliente: <strong className="text-white">{r.customerName}</strong>
                        {r.customerPhone && ` · Tel: ${r.customerPhone}`}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="font-mono text-sm font-extrabold text-[#FFD600] tabular-nums">
                        {r.startTime} – {r.endTime}
                      </p>
                      <p className="text-[11px] text-neutral-400">
                        {r.reservationDate} · {r.durationHours}h
                      </p>
                    </div>
                  </div>

                  {r.preOrderItems.length > 0 && (
                    <div className="rounded-lg border border-[#242424] bg-[#181818] px-3 py-2 text-xs">
                      <p className="font-bold text-[#FFD600] mb-1">Comida a alistar:</p>
                      <p className="text-neutral-200">
                        {r.preOrderItems.map((it) => `${it.quantity}x ${it.productName}`).join(' · ')}
                      </p>
                    </div>
                  )}

                  {r.notes && (
                    <p className="text-xs text-neutral-400">Nota: {r.notes}</p>
                  )}

                  {isActive && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {r.status === 'PENDIENTE' && (
                        <button
                          type="button"
                          onClick={() =>
                            void onApiAction(
                              'PATCH',
                              `/api/reservations/${r.id}/status`,
                              { status: 'EN_PREPARACION', sendToKitchen: true },
                              `Alistar / iniciar reserva ${r.customerName}`
                            )
                          }
                          className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#FFD600] px-3 text-xs font-extrabold text-[#111111] hover:bg-[#f2ca00]"
                        >
                          <ChefHat className="h-3.5 w-3.5" />
                          <span>
                            {r.preOrderItems.length > 0
                              ? 'Alistar Pedido en Cocina'
                              : 'Ocupar Mesa / Iniciar'}
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void onApiAction(
                            'PATCH',
                            `/api/reservations/${r.id}/status`,
                            { status: 'COMPLETADA' },
                            `Completar reserva ${r.customerName}`
                          )
                        }
                        className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-600/20 px-3 text-xs font-bold text-emerald-300 hover:bg-emerald-600 hover:text-white"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Completar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void onApiAction(
                            'PATCH',
                            `/api/reservations/${r.id}/status`,
                            { status: 'CANCELADA' },
                            `Cancelar reserva ${r.customerName}`
                          )
                        }
                        className="flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#E31B23]/15 px-3 text-xs font-bold text-red-300 hover:bg-[#E31B23] hover:text-white"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Cancelar</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
