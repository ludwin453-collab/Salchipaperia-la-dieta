import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  Camera,
  ImagePlus,
  Printer,
  FileDown,
  Split,
  Ban,
  DollarSign,
  Lock,
  Unlock,
  CheckCircle2,
  Receipt,
  Share2,
  Trash2,
  Eye,
  X,
} from 'lucide-react';
import type {
  Account,
  CashRegister,
  PaymentMethod,
  PosBootstrapState,
  User,
} from '../types/pos';
import { downloadReceiptPdf, type ReceiptPayload } from '../lib/exportUtils';
import { LaDietaLogo } from './LaDietaBrand';

interface CashierViewProps {
  state: PosBootstrapState;
  currentUser: User;
  onApiAction: (
    method: 'POST' | 'PATCH',
    url: string,
    body: unknown,
    description: string,
    queueIfOffline?: boolean
  ) => Promise<unknown>;
}

export function CashierView({ state, onApiAction }: CashierViewProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [openingInput, setOpeningInput] = useState('100.00');
  const [closingDeclaredInput, setClosingDeclaredInput] = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);

  // Movimientos extra (ingresos/gastos)
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [movType, setMovType] = useState<'INGRESO_EXTRA' | 'GASTO_AUTORIZADO'>('GASTO_AUTORIZADO');
  const [movMethod, setMovMethod] = useState<'EFECTIVO' | 'YAPE' | 'PLIN' | 'TRANSFERENCIA'>('EFECTIVO');
  const [movAmount, setMovAmount] = useState('');
  const [movNote, setMovNote] = useState('');

  // Cobro y calculadora de vuelto
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('EFECTIVO');
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [amountToPayStr, setAmountToPayStr] = useState('');
  const [receivedStr, setReceivedStr] = useState('');
  const [referenceNote, setReferenceNote] = useState('');
  const [validationCode, setValidationCode] = useState('');
  const [proofImageUrl, setProofImageUrl] = useState<string | null>(null);
  const [proofProcessing, setProofProcessing] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [viewingProof, setViewingProof] = useState<{
    url: string;
    title: string;
    code?: string | null;
  } | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackCaptureInputRef = useRef<HTMLInputElement | null>(null);

  // División de cuenta
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [splitRows, setSplitRows] = useState<Array<{ guestName: string; amount: string }>>([
    { guestName: 'Cliente 1', amount: '' },
    { guestName: 'Cliente 2', amount: '' },
  ]);

  // Anulación de pedido
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelAlreadyCooked, setCancelAlreadyCooked] = useState(false);

  // Vista previa de Comprobante Interno
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptPayload | null>(null);
  const [paperWidth, setPaperWidth] = useState<58 | 80>(80);

  const openRegister: CashRegister | undefined = useMemo(
    () => state.cashRegisters.find((c) => c.status === 'ABIERTA'),
    [state.cashRegisters]
  );

  const openAccounts = useMemo(
    () =>
      state.accounts.filter(
        (a) => a.status === 'ABIERTA' || a.status === 'PENDIENTE_PAGO'
      ),
    [state.accounts]
  );

  const tableMap = useMemo(
    () => new Map(state.tables.map((t) => [t.id, t])),
    [state.tables]
  );

  const selectedAccount: Account | null = useMemo(
    () => state.accounts.find((a) => a.id === selectedAccountId) ?? null,
    [state.accounts, selectedAccountId]
  );

  const selectedAccountOrders = useMemo(() => {
    if (!selectedAccount) return [];
    return state.orders.filter(
      (o) => o.accountId === selectedAccount.id && o.kitchenStatus !== 'ANULADO'
    );
  }, [selectedAccount, state.orders]);

  const registerStats = useMemo(() => {
    if (!openRegister) return { salesCash: 0, salesDigital: 0, expenses: 0, extraIncome: 0, expectedCash: 0 };
    const movs = state.payments.filter((p) => p.cashRegisterId === openRegister.id);
    let salesCash = 0;
    let salesDigital = 0;
    let expenses = 0;
    let extraIncome = 0;

    for (const m of movs) {
      if (m.movementType === 'GASTO_AUTORIZADO') {
        expenses += m.amount;
      } else if (m.movementType === 'INGRESO_EXTRA') {
        extraIncome += m.amount;
      } else {
        if (m.method === 'EFECTIVO' || m.method === 'COMBINADO') salesCash += m.amount;
        else salesDigital += m.amount;
      }
    }
    const expectedCash = openRegister.openingBalance + salesCash + extraIncome - expenses;
    return { salesCash, salesDigital, expenses, extraIncome, expectedCash };
  }, [openRegister, state.payments]);

  const paymentMap = useMemo(
    () => new Map(state.payments.map((p) => [p.id, p])),
    [state.payments]
  );

  const selectAccountForCheckout = (acc: Account) => {
    setSelectedAccountId(acc.id);
    setSelectedGuestId(null);
    const pending = Math.max(0, Number((acc.totalAmount - acc.paidAmount).toFixed(2)));
    setAmountToPayStr(pending.toFixed(2));
    setReceivedStr(pending.toFixed(2));
    setReferenceNote('');
    setValidationCode('');
    setProofImageUrl(null);
    setPaymentError(null);
  };

  const pendingBalance = selectedAccount
    ? Math.max(0, Number((selectedAccount.totalAmount - selectedAccount.paidAmount).toFixed(2)))
    : 0;

  const amountToPay = Number.parseFloat(amountToPayStr.replace(',', '.')) || 0;
  const hasExplicitReceived = receivedStr.trim() !== '';
  const rawReceivedAmount = Number.parseFloat(receivedStr.replace(',', '.'));
  const effectiveReceivedAmount = hasExplicitReceived
    ? Number.isFinite(rawReceivedAmount)
      ? rawReceivedAmount
      : 0
    : amountToPay;
  const calculatedChange =
    paymentMethod === 'EFECTIVO' || paymentMethod === 'COMBINADO'
      ? Math.max(0, Number((effectiveReceivedAmount - amountToPay).toFixed(2)))
      : 0;
  const isCashShort =
    (paymentMethod === 'EFECTIVO' || paymentMethod === 'COMBINADO') &&
    hasExplicitReceived &&
    effectiveReceivedAmount < amountToPay - 0.001;
  const hasDigitalValidation =
    paymentMethod === 'EFECTIVO' ||
    Boolean(proofImageUrl) ||
    validationCode.trim().length >= 3;

  const handleProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setProofProcessing(true);
    setPaymentError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
        reader.onload = () => {
          const raw = reader.result as string;
          const img = new Image();
          img.onload = () => {
            const maxDim = 900;
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              resolve(raw);
              return;
            }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.72));
          };
          img.onerror = () => resolve(raw);
          img.src = raw;
        };
        reader.readAsDataURL(file);
      });
      setProofImageUrl(dataUrl);
    } catch {
      setPaymentError('No se pudo procesar la fotografía seleccionada.');
    } finally {
      setProofProcessing(false);
    }
  };

  const stopCameraStream = () => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  };

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  const closeCameraModal = () => {
    stopCameraStream();
    setShowCameraModal(false);
    setCameraError(null);
  };

  const openCameraModal = async () => {
    setPaymentError(null);
    setCameraError(null);
    setCameraReady(false);
    setShowCameraModal(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador no permite cámara en vivo. Usa la opción de cámara/galería del dispositivo abajo.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCameraReady(true);
    } catch {
      setCameraError('No se pudo acceder a la cámara del dispositivo. Permite el permiso de cámara o usa la captura desde archivo.');
    }
  };

  const capturePhotoFromVideo = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const maxDim = 900;
    const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setProofImageUrl(canvas.toDataURL('image/jpeg', 0.72));
    closeCameraModal();
  };

  const handleOpenRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = Number.parseFloat(openingInput) || 0;
    await onApiAction('POST', '/api/cash-register/open', { openingBalance: val }, 'Apertura de caja');
  };

  const handleCloseRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openRegister) return;
    const declared = Number.parseFloat(closingDeclaredInput) || 0;
    const ok = await onApiAction(
      'POST',
      `/api/cash-register/${openRegister.id}/close`,
      { declaredBalance: declared },
      'Cierre de caja'
    );
    if (ok) {
      setShowCloseModal(false);
      setClosingDeclaredInput('');
    }
  };

  const handleSaveCashMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!openRegister) return;
    const ok = await onApiAction(
      'POST',
      '/api/cash-movements',
      {
        cashRegisterId: openRegister.id,
        movementType: movType,
        method: movMethod,
        amount: Number.parseFloat(movAmount) || 0,
        referenceNote: movNote,
      },
      `Movimiento de caja: ${movType}`
    );
    if (ok) {
      setShowMovementModal(false);
      setMovAmount('');
      setMovNote('');
    }
  };

  const handleRegisterPayment = async () => {
    if (!selectedAccount) return;
    if (!openRegister) {
      setPaymentError('Primero abre la caja para poder registrar el cobro.');
      return;
    }
    if (amountToPay <= 0 || amountToPay > pendingBalance + 0.01) {
      setPaymentError(`Ingresa un monto válido entre S/ 0.10 y S/ ${pendingBalance.toFixed(2)}.`);
      return;
    }
    if (isCashShort) {
      setPaymentError(
        `El pago recibido (S/ ${effectiveReceivedAmount.toFixed(2)}) no puede ser menor al monto a cobrar (S/ ${amountToPay.toFixed(2)}).`
      );
      return;
    }
    if (!hasDigitalValidation) {
      setPaymentError(
        `Para ${paymentMethod}, toma una foto del comprobante o ingresa el código de operación.`
      );
      return;
    }
    setPaymentError(null);

    const res = (await onApiAction(
      'POST',
      '/api/payments',
      {
        cashRegisterId: openRegister.id,
        accountId: selectedAccount.id,
        accountGuestId: selectedGuestId,
        method: paymentMethod,
        amountToApply: amountToPay,
        receivedAmount:
          paymentMethod === 'EFECTIVO' || paymentMethod === 'COMBINADO'
            ? effectiveReceivedAmount
            : amountToPay,
        referenceNote: referenceNote.trim() || null,
        validationCode: paymentMethod !== 'EFECTIVO' ? validationCode.trim() || null : null,
        proofImageUrl: paymentMethod !== 'EFECTIVO' ? proofImageUrl : null,
      },
      `Cobro S/ ${amountToPay.toFixed(2)} (${paymentMethod})`,
      true
    )) as { receiptPayload?: ReceiptPayload; pendingBalance?: number } | boolean;

    if (res && typeof res === 'object' && res.receiptPayload) {
      setPreviewReceipt(res.receiptPayload);
      setValidationCode('');
      setProofImageUrl(null);
      setReferenceNote('');
      if ((res.pendingBalance ?? 0) <= 0.01) {
        setSelectedAccountId(null);
      } else {
        const nextPending = (res.pendingBalance ?? 0).toFixed(2);
        setAmountToPayStr(nextPending);
        setReceivedStr(nextPending);
      }
    }
  };

  const handleSaveSplit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;
    const guests = splitRows.map((r) => ({
      guestName: r.guestName.trim() || 'Cliente',
      amount: Number.parseFloat(r.amount) || 0,
    }));
    const ok = await onApiAction(
      'POST',
      `/api/accounts/${selectedAccount.id}/split`,
      { guests },
      'División de cuenta'
    );
    if (ok) setShowSplitModal(false);
  };

  const handleCancelOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelOrderId) return;
    const ok = await onApiAction(
      'POST',
      `/api/orders/${cancelOrderId}/cancel`,
      { reason: cancelReason, alreadyCooked: cancelAlreadyCooked },
      'Anulación de pedido'
    );
    if (ok) {
      setCancelOrderId(null);
      setCancelReason('');
    }
  };

  const handleShareReceiptText = async (rec: ReceiptPayload) => {
    const text = [
      `LA DIETA - SALCHIPAPERÍA`,
      `Comprobante Interno: ${rec.receiptNumber}`,
      `Mesa/Tipo: ${rec.tableLabel} | Cliente: ${rec.customerName}`,
      ...rec.items.map((i) => `• ${i.qty}x ${i.name} = S/ ${(i.qty * i.price).toFixed(2)}`),
      `TOTAL COBRADO: S/ ${rec.total.toFixed(2)} (${rec.paymentMethod})`,
      `Vuelto: S/ ${rec.change.toFixed(2)}`,
      `Comprobante interno de consumo (no tributario).`,
    ].join('\n');
    if (navigator.share) {
      try {
        await navigator.share({ title: `Ticket ${rec.receiptNumber}`, text });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    await navigator.clipboard?.writeText(text);
  };

  return (
    <div className="space-y-6 pb-16">
      {/* Barra de Caja */}
      <div className="flex flex-col gap-4 rounded-2xl border border-[#2A2A2A] bg-[#161616] p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-2xl font-extrabold text-white">Módulo de Caja y Cobranza</h2>
          {openRegister ? (
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-neutral-300">
              <span className="font-bold text-emerald-400">CAJA ABIERTA</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Base: S/ {openRegister.openingBalance.toFixed(2)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Efectivo ventas: S/ {registerStats.salesCash.toFixed(2)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Yape/Plin/Transf: S/ {registerStats.salesDigital.toFixed(2)}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">Gastos: S/ {registerStats.expenses.toFixed(2)}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-bold text-[#FFD600] tabular-nums">
                Efectivo esperado: S/ {registerStats.expectedCash.toFixed(2)}
              </span>
            </div>
          ) : (
            <p className="mt-1 text-sm text-amber-300">
              No hay una caja abierta en este momento. Realiza la apertura para registrar cobros.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {!openRegister ? (
            <form onSubmit={handleOpenRegister} className="flex items-center gap-2">
              <input
                type="number"
                step="0.10"
                min="0"
                value={openingInput}
                onChange={(e) => setOpeningInput(e.target.value)}
                placeholder="Saldo inicial S/"
                className="h-11 w-32 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-sm text-white"
              />
              <button
                type="submit"
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500"
              >
                <Unlock className="h-4 w-4" />
                <span>Abrir Caja</span>
              </button>
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowMovementModal(true)}
                className="flex min-h-[44px] items-center gap-2 rounded-xl border border-[#2E2E2E] bg-[#1E1E1E] px-4 py-2 text-xs font-bold text-white hover:bg-[#2A2A2A]"
              >
                <DollarSign className="h-4 w-4 text-[#FFD600]" />
                <span>Ingreso / Gasto</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setClosingDeclaredInput(registerStats.expectedCash.toFixed(2));
                  setShowCloseModal(true);
                }}
                className="flex min-h-[44px] items-center gap-2 rounded-xl bg-[#E31B23] px-4 py-2 text-xs font-bold text-white hover:bg-[#c8161d]"
              >
                <Lock className="h-4 w-4" />
                <span>Cerrar Caja</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Área Principal: Cuentas por Cobrar + Calculadora de Cobro */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Lista de cuentas abiertas */}
        <div className="space-y-3 lg:col-span-5">
          <h3 className="font-display text-lg font-bold text-white">
            Cuentas Activas y Pendientes ({openAccounts.length})
          </h3>
          {openAccounts.length === 0 ? (
            <div className="rounded-2xl border border-[#262626] bg-[#161616] p-8 text-center text-sm text-neutral-400">
              No hay cuentas pendientes de cobro en este momento.
            </div>
          ) : (
            openAccounts.map((acc) => {
              const tbl = acc.tableId ? tableMap.get(acc.tableId) : null;
              const pending = Math.max(0, acc.totalAmount - acc.paidAmount);
              const isSelected = selectedAccount?.id === acc.id;
              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => selectAccountForCheckout(acc)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                    isSelected
                      ? 'border-[#FFD600] bg-[#FFD600]/10'
                      : 'border-[#2A2A2A] bg-[#181818] hover:border-neutral-600'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-display text-sm font-extrabold text-white truncate">
                      {tbl ? tbl.label : 'PARA LLEVAR'} · {acc.mainCustomerName}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-400 truncate">
                      Mozo: {acc.waiterName} · Total: S/ {acc.totalAmount.toFixed(2)}
                      {acc.paidAmount > 0 && ` · Abonado: S/ ${acc.paidAmount.toFixed(2)}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-base font-extrabold text-[#FFD600] tabular-nums">
                      S/ {pending.toFixed(2)}
                    </p>
                    <p className="text-[11px] font-semibold text-amber-300">Por cobrar</p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Panel de Checkout, División y Anulación */}
        <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5 lg:col-span-7">
          {!selectedAccount ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center text-center text-neutral-400">
              <Calculator className="mb-3 h-10 w-10 text-neutral-600" />
              <p className="font-display text-base font-bold text-white">Selecciona una cuenta para cobrar</p>
              <p className="mt-1 text-xs text-neutral-400">
                Podrás dividir el consumo por cliente, aceptar pagos parciales, calcular el vuelto e imprimir el ticket interno.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#262626] pb-3">
                <div>
                  <h3 className="font-display text-xl font-extrabold text-white">
                    {selectedAccount.tableId ? tableMap.get(selectedAccount.tableId)?.label : 'PARA LLEVAR'} ·{' '}
                    {selectedAccount.mainCustomerName}
                  </h3>
                  <p className="text-xs text-neutral-400">
                    Total cuenta: S/ {selectedAccount.totalAmount.toFixed(2)} · Pagado: S/ {selectedAccount.paidAmount.toFixed(2)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSplitRows([
                      { guestName: selectedAccount.mainCustomerName, amount: (pendingBalance / 2).toFixed(2) },
                      { guestName: 'Cliente 2', amount: (pendingBalance - Number((pendingBalance / 2).toFixed(2))).toFixed(2) },
                    ]);
                    setShowSplitModal(true);
                  }}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#2E2E2E] bg-[#121212] px-3.5 py-2 text-xs font-bold text-[#FFD600] hover:bg-[#222222]"
                >
                  <Split className="h-4 w-4" />
                  <span>Dividir Cuenta</span>
                </button>
              </div>

              {/* Comensales divididos si existen */}
              {selectedAccount.guests && selectedAccount.guests.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-neutral-300">Cuentas Individuales (División)</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGuestId(null);
                        setAmountToPayStr(pendingBalance.toFixed(2));
                        setReceivedStr(pendingBalance.toFixed(2));
                      }}
                      className={`min-h-[40px] rounded-xl border px-3 py-1.5 text-xs font-bold ${
                        selectedGuestId === null
                          ? 'border-[#FFD600] bg-[#FFD600] text-[#111111]'
                          : 'border-[#2E2E2E] bg-[#121212] text-neutral-300'
                      }`}
                    >
                      Toda la mesa (S/ {pendingBalance.toFixed(2)})
                    </button>
                    {selectedAccount.guests.map((g) => {
                      const gPending = Math.max(0, Number((g.totalAssigned - g.paidAmount).toFixed(2)));
                      return (
                        <button
                          key={g.id}
                          type="button"
                          disabled={g.isSettled}
                          onClick={() => {
                            setSelectedGuestId(g.id);
                            setAmountToPayStr(gPending.toFixed(2));
                            setReceivedStr(gPending.toFixed(2));
                          }}
                          className={`min-h-[40px] rounded-xl border px-3 py-1.5 text-xs font-bold ${
                            g.isSettled
                              ? 'border-emerald-700/40 bg-emerald-950/30 text-emerald-400 line-through'
                              : selectedGuestId === g.id
                                ? 'border-[#FFD600] bg-[#FFD600] text-[#111111]'
                                : 'border-[#2E2E2E] bg-[#121212] text-white'
                          }`}
                        >
                          {g.guestName}: S/ {gPending.toFixed(2)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Detalle de consumos + opción de anulación controlada */}
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border border-[#262626] bg-[#121212] p-3">
                {selectedAccountOrders.map((ord) => (
                  <div key={ord.id} className="border-b border-[#222222] pb-2 last:border-b-0 last:pb-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-bold text-neutral-300">
                        {ord.orderCode} ({ord.kitchenStatus})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setCancelOrderId(ord.id);
                          setCancelAlreadyCooked(ord.kitchenStatus !== 'NUEVO');
                        }}
                        className="flex items-center gap-1 text-red-400 hover:text-red-300 font-semibold"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        <span>Anular comanda</span>
                      </button>
                    </div>
                    {ord.items.map((it) => (
                      <div key={it.id} className="mt-1 flex justify-between text-xs text-neutral-200">
                        <span>
                          {it.quantity}x {it.productNameSnapshot}
                        </span>
                        <span className="font-mono tabular-nums">
                          S/ {(it.quantity * it.unitPriceSnapshot).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Métodos de Pago y Calculadora Automática */}
              <div className="space-y-4">
                {!openRegister && (
                  <div className="rounded-xl border border-amber-400/60 bg-amber-500/10 p-3.5 space-y-2.5">
                    <p className="text-xs font-bold text-amber-200">
                      La caja está cerrada. Ábrela aquí para aceptar pagos en efectivo o digitales:
                    </p>
                    <form onSubmit={handleOpenRegister} className="flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        step="0.10"
                        min="0"
                        value={openingInput}
                        onChange={(e) => setOpeningInput(e.target.value)}
                        placeholder="Saldo inicial S/"
                        className="h-11 w-32 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-sm text-white"
                      />
                      <button
                        type="submit"
                        className="flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-extrabold text-white hover:bg-emerald-500"
                      >
                        <Unlock className="h-4 w-4" />
                        <span>Abrir Caja Ahora</span>
                      </button>
                    </form>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {(['EFECTIVO', 'YAPE', 'PLIN', 'TRANSFERENCIA', 'COMBINADO'] as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setPaymentMethod(m);
                        setPaymentError(null);
                      }}
                      className={`min-h-[44px] rounded-xl border px-2 py-2 text-xs font-bold transition-colors ${
                        paymentMethod === m
                          ? 'border-[#FFD600] bg-[#FFD600] text-[#111111]'
                          : 'border-[#2E2E2E] bg-[#121212] text-neutral-300 hover:bg-[#222222]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-neutral-300">
                      Monto a Cobrar (permite pago parcial) S/
                    </label>
                    <input
                      type="number"
                      step="0.10"
                      min="0.10"
                      value={amountToPayStr}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAmountToPayStr(val);
                        setPaymentError(null);
                        if (receivedStr === amountToPayStr) {
                          setReceivedStr(val);
                        }
                      }}
                      className="h-12 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3.5 font-mono text-lg font-bold text-white"
                    />
                  </div>

                  {(paymentMethod === 'EFECTIVO' || paymentMethod === 'COMBINADO') && (
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-neutral-300">
                        Pago Recibido del Cliente S/
                      </label>
                      <input
                        type="number"
                        step="0.10"
                        min="0"
                        value={receivedStr}
                        onChange={(e) => {
                          setReceivedStr(e.target.value);
                          setPaymentError(null);
                        }}
                        placeholder={amountToPay.toFixed(2)}
                        className="h-12 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3.5 font-mono text-lg font-bold text-[#FFD600]"
                      />
                    </div>
                  )}
                </div>

                {(paymentMethod === 'EFECTIVO' || paymentMethod === 'COMBINADO') && (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setReceivedStr(amountToPay.toFixed(2));
                          setPaymentError(null);
                        }}
                        className="min-h-[38px] rounded-lg border border-[#2E2E2E] bg-[#141414] px-3 text-xs font-bold text-white hover:border-[#FFD600]"
                      >
                        Exacto (S/ {amountToPay.toFixed(2)})
                      </button>
                      {[10, 20, 50, 100].map((bill) => (
                        <button
                          key={bill}
                          type="button"
                          onClick={() => {
                            setReceivedStr(bill.toFixed(2));
                            setPaymentError(null);
                          }}
                          className="min-h-[38px] rounded-lg border border-[#2E2E2E] bg-[#141414] px-3 font-mono text-xs font-bold text-[#FFD600] hover:border-[#FFD600]"
                        >
                          S/ {bill}
                        </button>
                      ))}
                    </div>

                    <div
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                        isCashShort
                          ? 'border-[#E31B23]/70 bg-[#E31B23]/10'
                          : 'border-emerald-500/40 bg-emerald-500/10'
                      }`}
                    >
                      <span className={`text-sm font-bold ${isCashShort ? 'text-red-300' : 'text-emerald-300'}`}>
                        {isCashShort ? 'Falta efectivo por recibir' : 'Vuelto Automático'}
                      </span>
                      <span
                        className={`font-mono text-2xl font-extrabold tabular-nums ${
                          isCashShort ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        S/{' '}
                        {isCashShort
                          ? (amountToPay - effectiveReceivedAmount).toFixed(2)
                          : calculatedChange.toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}

                {paymentMethod !== 'EFECTIVO' && (
                  <div className="rounded-xl border border-[#2E2E2E] bg-[#141414] p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-extrabold text-[#FFD600]">
                        Convalidar pago {paymentMethod}: Foto o Código de operación
                      </p>
                      <span
                        className={`text-xs font-bold ${
                          hasDigitalValidation ? 'text-emerald-400' : 'text-amber-300'
                        }`}
                      >
                        {hasDigitalValidation ? 'Validado ✓' : 'Requiere foto o código'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void openCameraModal()}
                        disabled={proofProcessing}
                        className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#E31B23] px-3 py-2 text-xs font-extrabold text-white hover:bg-[#c8161d] disabled:opacity-50"
                      >
                        <Camera className="h-4 w-4 shrink-0" />
                        <span>{proofProcessing ? 'Procesando...' : 'Tomar Foto'}</span>
                      </button>

                      <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#2E2E2E] bg-[#1C1C1C] px-3 py-2 text-xs font-bold text-white hover:border-[#FFD600]">
                        <ImagePlus className="h-4 w-4 shrink-0 text-[#FFD600]" />
                        <span>Subir Captura</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleProofFileChange}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {proofImageUrl && (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-[#101010] p-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <img
                            src={proofImageUrl}
                            alt="Comprobante capturado"
                            className="h-16 w-16 rounded-lg object-cover border border-[#2E2E2E]"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-emerald-400">Foto del pago adjunta</p>
                            <p className="text-[11px] text-neutral-400">Se guardará con la venta</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setProofImageUrl(null)}
                          className="flex min-h-[40px] items-center gap-1 rounded-lg bg-[#262626] px-2.5 text-xs font-bold text-red-300 hover:bg-[#E31B23] hover:text-white"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Quitar</span>
                        </button>
                      </div>
                    )}

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-neutral-300">
                        Código de operación / validación (si no hay foto)
                      </label>
                      <input
                        type="text"
                        value={validationCode}
                        onChange={(e) => {
                          setValidationCode(e.target.value);
                          setPaymentError(null);
                        }}
                        placeholder={`Ej: N.° operación ${paymentMethod}`}
                        className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3.5 font-mono text-sm text-white placeholder-neutral-500 focus:border-[#FFD600] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <input
                  type="text"
                  value={referenceNote}
                  onChange={(e) => setReferenceNote(e.target.value)}
                  placeholder="Nota adicional opcional"
                  className="h-10 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3.5 text-xs text-white placeholder-neutral-500"
                />

                {paymentError && (
                  <p className="rounded-xl border border-[#E31B23]/60 bg-[#2A1214] px-3.5 py-2.5 text-xs font-bold text-red-200">
                    {paymentError}
                  </p>
                )}

                <button
                  type="button"
                  disabled={proofProcessing}
                  onClick={handleRegisterPayment}
                  className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-5 py-3 text-sm font-extrabold text-[#111111] hover:bg-[#f2ca00] disabled:opacity-40"
                >
                  <CheckCircle2 className="h-5 w-5" />
                  <span>Registrar Pago y Generar Comprobante Interno</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Historial de Comprobantes Internos y Pagos del Día */}
      <div className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
        <h3 className="font-display text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Receipt className="h-5 w-5 text-[#FFD600]" />
          <span>Comprobantes Internos Recientes ({state.receipts.length})</span>
        </h3>
        {state.receipts.length === 0 ? (
          <p className="text-sm text-neutral-400">Aún no se han emitido comprobantes en el sistema.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#262626] text-xs text-neutral-400">
                <tr>
                  <th className="py-2.5 pr-4">Ticket</th>
                  <th className="py-2.5 pr-4">Mesa / Cliente</th>
                  <th className="py-2.5 pr-4">Método</th>
                  <th className="py-2.5 pr-4 text-right">Cobrado</th>
                  <th className="py-2.5 pr-4 text-right">Vuelto</th>
                  <th className="py-2.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#222222]">
                {state.receipts.slice(0, 15).map((r) => {
                  const data = JSON.parse(r.payloadJson) as ReceiptPayload;
                  const pay = paymentMap.get(r.paymentId);
                  return (
                    <tr key={r.id} className="hover:bg-[#1E1E1E]">
                      <td className="py-2.5 pr-4 font-mono font-bold text-[#FFD600]">{r.receiptNumber}</td>
                      <td className="py-2.5 pr-4">
                        <span className="font-semibold text-white">{data.tableLabel}</span>
                        <span className="block text-xs text-neutral-400">{data.customerName}</span>
                      </td>
                      <td className="py-2.5 pr-4 text-xs text-neutral-300">
                        <span>{data.paymentMethod}</span>
                        {(pay?.validationCode || data.validationCode) && (
                          <span className="block font-mono text-[11px] text-[#FFD600]">
                            Cód: {pay?.validationCode ?? data.validationCode}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono font-bold tabular-nums">
                        S/ {data.total.toFixed(2)}
                      </td>
                      <td className="py-2.5 pr-4 text-right font-mono text-neutral-400 tabular-nums">
                        S/ {data.change.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {pay?.proofImageUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setViewingProof({
                                  url: pay.proofImageUrl as string,
                                  title: `${r.receiptNumber} · ${data.paymentMethod}`,
                                  code: pay.validationCode,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span>Foto</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPreviewReceipt(data)}
                            className="rounded-lg border border-[#2E2E2E] bg-[#121212] px-3 py-1.5 text-xs font-bold text-white hover:border-[#FFD600]"
                          >
                            Ver / Imprimir
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: División de Cuenta */}
      {showSplitModal && selectedAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form
            onSubmit={handleSaveSplit}
            className="w-full max-w-lg rounded-2xl border border-[#2E2E2E] bg-[#161616] p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-extrabold text-white">
              Dividir Cuenta · Total S/ {selectedAccount.totalAmount.toFixed(2)}
            </h3>
            <div className="space-y-2.5">
              {splitRows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={row.guestName}
                    onChange={(e) =>
                      setSplitRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, guestName: e.target.value } : r)))
                    }
                    placeholder={`Cliente ${i + 1}`}
                    className="h-11 flex-1 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
                  />
                  <input
                    type="number"
                    step="0.10"
                    value={row.amount}
                    onChange={(e) =>
                      setSplitRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, amount: e.target.value } : r)))
                    }
                    placeholder="S/"
                    className="h-11 w-28 rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-sm text-white"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setSplitRows((prev) => [...prev, { guestName: `Cliente ${prev.length + 1}`, amount: '0' }])}
              className="text-xs font-bold text-[#FFD600] hover:underline"
            >
              + Agregar otro comensal
            </button>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSplitModal(false)}
                className="min-h-[42px] rounded-xl px-4 text-xs font-bold text-neutral-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[#FFD600] px-4 text-xs font-extrabold text-[#111111]"
              >
                Guardar División
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Cierre de Caja con Reporte de Diferencia */}
      {showCloseModal && openRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form
            onSubmit={handleCloseRegister}
            className="w-full max-w-md rounded-2xl border border-[#2E2E2E] bg-[#161616] p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-extrabold text-white">Cierre de Caja</h3>
            <div className="rounded-xl border border-[#262626] bg-[#111111] p-3.5 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-neutral-400">Saldo inicial:</span>
                <span className="font-mono tabular-nums">S/ {openRegister.openingBalance.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-400">Efectivo esperado en caja:</span>
                <span className="font-mono font-bold text-[#FFD600] tabular-nums">
                  S/ {registerStats.expectedCash.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-neutral-400">
                <span>Cobros digitales (Yape/Plin/Transf):</span>
                <span className="font-mono tabular-nums">S/ {registerStats.salesDigital.toFixed(2)}</span>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-300">
                Efectivo real contado en gaveta (S/)
              </label>
              <input
                type="number"
                step="0.10"
                required
                value={closingDeclaredInput}
                onChange={(e) => setClosingDeclaredInput(e.target.value)}
                className="h-12 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3.5 font-mono text-lg font-bold text-white"
              />
              <p className="mt-1.5 font-mono text-xs text-neutral-300 tabular-nums">
                Diferencia:{' '}
                <strong
                  className={
                    (Number.parseFloat(closingDeclaredInput) || 0) - registerStats.expectedCash < -0.01
                      ? 'text-red-400'
                      : 'text-emerald-400'
                  }
                >
                  S/ {((Number.parseFloat(closingDeclaredInput) || 0) - registerStats.expectedCash).toFixed(2)}
                </strong>
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCloseModal(false)}
                className="min-h-[42px] rounded-xl px-4 text-xs font-bold text-neutral-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[#E31B23] px-5 text-xs font-extrabold text-white"
              >
                Confirmar Cierre
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Ingresos Extra / Gastos Autorizados */}
      {showMovementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form
            onSubmit={handleSaveCashMovement}
            className="w-full max-w-md rounded-2xl border border-[#2E2E2E] bg-[#161616] p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-extrabold text-white">Movimiento de Caja</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMovType('GASTO_AUTORIZADO')}
                className={`min-h-[42px] rounded-xl border text-xs font-bold ${
                  movType === 'GASTO_AUTORIZADO'
                    ? 'border-[#E31B23] bg-[#E31B23] text-white'
                    : 'border-[#2E2E2E] bg-[#111111] text-neutral-300'
                }`}
              >
                Gasto Autorizado
              </button>
              <button
                type="button"
                onClick={() => setMovType('INGRESO_EXTRA')}
                className={`min-h-[42px] rounded-xl border text-xs font-bold ${
                  movType === 'INGRESO_EXTRA'
                    ? 'border-emerald-500 bg-emerald-600 text-white'
                    : 'border-[#2E2E2E] bg-[#111111] text-neutral-300'
                }`}
              >
                Ingreso Extra
              </button>
            </div>
            <select
              value={movMethod}
              onChange={(e) => setMovMethod(e.target.value as typeof movMethod)}
              className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
            >
              <option value="EFECTIVO">Efectivo</option>
              <option value="YAPE">Yape</option>
              <option value="PLIN">Plin</option>
              <option value="TRANSFERENCIA">Transferencia</option>
            </select>
            <input
              type="number"
              step="0.10"
              min="0.10"
              required
              value={movAmount}
              onChange={(e) => setMovAmount(e.target.value)}
              placeholder="Monto S/"
              className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 font-mono text-sm text-white"
            />
            <input
              type="text"
              required
              value={movNote}
              onChange={(e) => setMovNote(e.target.value)}
              placeholder="Motivo autorizado (Ej: Compra de gas / servilletas)"
              className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowMovementModal(false)}
                className="min-h-[42px] rounded-xl px-4 text-xs font-bold text-neutral-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[#FFD600] px-5 text-xs font-extrabold text-[#111111]"
              >
                Registrar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Anulación Controlada de Comanda */}
      {cancelOrderId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <form
            onSubmit={handleCancelOrder}
            className="w-full max-w-md rounded-2xl border border-[#2E2E2E] bg-[#161616] p-6 space-y-4"
          >
            <h3 className="font-display text-lg font-extrabold text-red-400">Anular Comanda</h3>
            <input
              type="text"
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Motivo obligatorio de la anulación"
              className="h-11 w-full rounded-xl border border-[#2E2E2E] bg-[#111111] px-3 text-sm text-white"
            />
            <label className="flex items-center gap-2.5 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={cancelAlreadyCooked}
                onChange={(e) => setCancelAlreadyCooked(e.target.checked)}
                className="h-4 w-4 accent-[#E31B23]"
              />
              <span>
                El plato ya fue preparado (registrar desperdicio/merma en lugar de devolver al stock)
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelOrderId(null)}
                className="min-h-[42px] rounded-xl px-4 text-xs font-bold text-neutral-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-xl bg-[#E31B23] px-5 text-xs font-extrabold text-white"
              >
                Confirmar Anulación
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal: Vista Previa & Impresión de Comprobante Interno (58mm / 80mm) */}
      {previewReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[#2E2E2E] bg-[#161616]">
            <div className="no-print flex items-center justify-between border-b border-[#262626] px-5 py-3.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPaperWidth(58)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                    paperWidth === 58 ? 'bg-[#FFD600] text-[#111111]' : 'bg-[#242424] text-neutral-300'
                  }`}
                >
                  58 mm
                </button>
                <button
                  type="button"
                  onClick={() => setPaperWidth(80)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                    paperWidth === 80 ? 'bg-[#FFD600] text-[#111111]' : 'bg-[#242424] text-neutral-300'
                  }`}
                >
                  80 mm
                </button>
              </div>
              <button
                type="button"
                onClick={() => setPreviewReceipt(null)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-[#242424]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto bg-neutral-900 p-5 flex justify-center">
              <div
                className="bg-white text-black p-4 font-mono text-xs shadow-sm"
                style={{ width: paperWidth === 58 ? '240px' : '310px' }}
              >
                <div className="flex flex-col items-center text-center">
                  <LaDietaLogo size={54} />
                  <p className="mt-2 font-bold text-sm">LA DIETA - SALCHIPAPERÍA</p>
                  <p className="text-[10px]">Av. Centenario N.° 401, Sicuani - Canchis - Cusco</p>
                  <p className="text-[10px]">Pedidos: 963758935 - 963759084</p>
                </div>
                <hr className="my-2 border-dashed border-black" />
                <p className="font-bold">TICKET: {previewReceipt.receiptNumber}</p>
                <p>Pedido: {previewReceipt.orderCode}</p>
                <p>Ubicación: {previewReceipt.tableLabel}</p>
                <p>Cliente: {previewReceipt.customerName}</p>
                <p>Mozo: {previewReceipt.waiterName}</p>
                <p>Fecha: {new Date(previewReceipt.dateTime).toLocaleString('es-PE')}</p>
                <hr className="my-2 border-dashed border-black" />
                <div className="space-y-1">
                  {previewReceipt.items.map((it, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span>
                        {it.qty}x {it.name}
                      </span>
                      <span className="shrink-0">S/ {(it.qty * it.price).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <hr className="my-2 border-dashed border-black" />
                <div className="flex justify-between font-bold text-sm">
                  <span>TOTAL COBRADO:</span>
                  <span>S/ {previewReceipt.total.toFixed(2)}</span>
                </div>
                <p className="mt-1">Método: {previewReceipt.paymentMethod}</p>
                {previewReceipt.validationCode && (
                  <p className="font-bold">Cód. Operación: {previewReceipt.validationCode}</p>
                )}
                <p>Recibido: S/ {previewReceipt.received.toFixed(2)}</p>
                <p className="font-bold">Vuelto: S/ {previewReceipt.change.toFixed(2)}</p>
                <hr className="my-2 border-dashed border-black" />
                <p className="text-center font-bold text-[10px]">
                  COMPROBANTE INTERNO DE CONSUMO — NO ES UN COMPROBANTE TRIBUTARIO
                </p>
                <p className="text-center mt-1 text-[10px]">¡Gracias por darte este gustito!</p>
              </div>
            </div>

            <div className="no-print flex flex-wrap gap-2 border-t border-[#262626] p-4">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex flex-1 min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[#FFD600] px-3 text-xs font-extrabold text-[#111111]"
              >
                <Printer className="h-4 w-4" />
                <span>Imprimir Térmica</span>
              </button>
              <button
                type="button"
                onClick={() => downloadReceiptPdf(previewReceipt, paperWidth)}
                className="flex flex-1 min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[#E31B23] px-3 text-xs font-extrabold text-white"
              >
                <FileDown className="h-4 w-4" />
                <span>PDF {paperWidth}mm</span>
              </button>
              <button
                type="button"
                onClick={() => handleShareReceiptText(previewReceipt)}
                className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[#2E2E2E] bg-[#1F1F1F] px-3 text-xs font-bold text-white"
              >
                <Share2 className="h-4 w-4" />
                <span>Compartir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Cámara en Vivo para Convalidar Yape / Plin / Transferencia */}
      {showCameraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#2E2E2E] bg-[#161616] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-extrabold text-[#FFD600]">
                  Tomar Foto · {paymentMethod}
                </h3>
                <p className="text-xs text-neutral-400">
                  Enfoca el celular del cliente o comprobante de transferencia
                </p>
              </div>
              <button
                type="button"
                onClick={closeCameraModal}
                aria-label="Cerrar cámara"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2E2E2E] text-neutral-300 hover:bg-[#242424]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {cameraError ? (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200 space-y-3">
                <p>{cameraError}</p>
                <button
                  type="button"
                  onClick={() => fallbackCaptureInputRef.current?.click()}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-4 text-xs font-extrabold text-[#111111]"
                >
                  <Camera className="h-4 w-4" />
                  <span>Abrir Cámara / Archivo del Dispositivo</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="relative overflow-hidden rounded-xl border border-[#2A2A2A] bg-black aspect-[4/3] flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                  {!cameraReady && (
                    <span className="absolute text-xs font-semibold text-neutral-300">
                      Iniciando cámara...
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!cameraReady}
                    onClick={capturePhotoFromVideo}
                    className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#FFD600] px-4 text-sm font-extrabold text-[#111111] hover:bg-[#f2ca00] disabled:opacity-40"
                  >
                    <Camera className="h-5 w-5" />
                    <span>Capturar Foto</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fallbackCaptureInputRef.current?.click()}
                    className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-[#2E2E2E] bg-[#1E1E1E] px-3.5 text-xs font-bold text-white"
                  >
                    <ImagePlus className="h-4 w-4 text-[#FFD600]" />
                    <span>Archivo</span>
                  </button>
                </div>
              </div>
            )}

            <input
              ref={fallbackCaptureInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                void handleProofFileChange(e);
                closeCameraModal();
              }}
              className="hidden"
            />
          </div>
        </div>
      )}

      {/* Modal: Ver Foto del Comprobante Digital */}
      {viewingProof && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#2E2E2E] bg-[#161616] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-display text-base font-extrabold text-[#FFD600]">{viewingProof.title}</h3>
                {viewingProof.code && (
                  <p className="font-mono text-xs text-neutral-300">Código: {viewingProof.code}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setViewingProof(null)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#2E2E2E] text-neutral-300 hover:bg-[#242424]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={viewingProof.url}
              alt="Comprobante de pago digital"
              className="max-h-[65vh] w-full rounded-xl border border-[#262626] bg-black object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
