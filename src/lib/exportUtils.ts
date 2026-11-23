import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { PosBootstrapState } from '../types/pos';

export interface ReceiptPayload {
  receiptNumber: string;
  orderCode: string;
  tableLabel: string;
  customerName: string;
  waiterName: string;
  dateTime: string;
  items: Array<{ name: string; qty: number; price: number }>;
  total: number;
  accountTotal?: number;
  pendingAfter?: number;
  received: number;
  change: number;
  paymentMethod: string;
  validationCode?: string | null;
}

export function downloadReceiptPdf(data: ReceiptPayload, widthMm: 58 | 80 = 80): void {
  const heightMm = Math.max(130, 88 + data.items.length * 7);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [widthMm, heightMm],
  });

  const margin = 4;
  const maxWidth = widthMm - margin * 2;
  let y = 7;

  const centerText = (text: string, size = 8, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) {
      doc.text(line, widthMm / 2, y, { align: 'center' });
      y += size * 0.45 + 0.8;
    }
  };

  const leftText = (text: string, size = 7.5, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, maxWidth) as string[];
    for (const line of lines) {
      doc.text(line, margin, y);
      y += size * 0.44 + 0.7;
    }
  };

  centerText('LA DIETA - SALCHIPAPERÍA', widthMm === 58 ? 9.5 : 11, true);
  centerText('Av. Centenario N.° 401, Sicuani - Canchis - Cusco', 6.8);
  centerText('Pedidos: 963758935 - 963759084', 6.8);
  y += 1.5;
  doc.line(margin, y, widthMm - margin, y);
  y += 3.5;

  leftText(`COMPROBANTE: ${data.receiptNumber}`, 8, true);
  leftText(`Pedido: ${data.orderCode} | ${data.tableLabel}`, 7.2);
  leftText(`Cliente: ${data.customerName}`, 7.2);
  leftText(`Mozo: ${data.waiterName}`, 7.2);
  leftText(`Fecha/Hora: ${new Date(data.dateTime).toLocaleString('es-PE')}`, 7.2);
  y += 1;
  doc.line(margin, y, widthMm - margin, y);
  y += 3.5;

  for (const item of data.items) {
    const subtotal = `S/ ${(item.qty * item.price).toFixed(2)}`;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.3);
    const nameText = `${item.qty}x ${item.name}`;
    const trimmed = nameText.length > (widthMm === 58 ? 22 : 30) ? `${nameText.slice(0, widthMm === 58 ? 21 : 29)}…` : nameText;
    doc.text(trimmed, margin, y);
    doc.text(subtotal, widthMm - margin, y, { align: 'right' });
    y += 4;
  }

  y += 1;
  doc.line(margin, y, widthMm - margin, y);
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('IMPORTE COBRADO:', margin, y);
  doc.text(`S/ ${data.total.toFixed(2)}`, widthMm - margin, y, { align: 'right' });
  y += 4.5;

  leftText(`Método de pago: ${data.paymentMethod}`, 7.5);
  if (data.validationCode) {
    leftText(`Cód. Operación: ${data.validationCode}`, 7.5, true);
  }
  leftText(`Importe recibido: S/ ${data.received.toFixed(2)}`, 7.5);
  leftText(`Vuelto entregado: S/ ${data.change.toFixed(2)}`, 8, true);
  if (data.pendingAfter !== undefined && data.pendingAfter > 0.01) {
    leftText(`Saldo pendiente de mesa: S/ ${data.pendingAfter.toFixed(2)}`, 7.5, true);
  }

  y += 2;
  doc.line(margin, y, widthMm - margin, y);
  y += 4;
  centerText('COMPROBANTE INTERNO DE CONSUMO', 7, true);
  centerText('NO ES UN COMPROBANTE TRIBUTARIO', 6.8, true);
  centerText('¡Gracias por darte este gustito!', 7.5);

  doc.save(`${data.receiptNumber}_${widthMm}mm.pdf`);
}

export function exportReportsExcel(state: PosBootstrapState, fromIso: string, toIso: string): void {
  const from = new Date(`${fromIso}T00:00:00`).getTime();
  const to = new Date(`${toIso}T23:59:59.999`).getTime();

  const inRange = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= from && t <= to;
  };

  const wb = XLSX.utils.book_new();

  // Hoja 1: Ventas / Pagos
  const paymentsData = state.payments
    .filter((p) => inRange(p.createdAt))
    .map((p) => ({
      Fecha: new Date(p.createdAt).toLocaleString('es-PE'),
      Tipo: p.movementType,
      Metodo: p.method,
      Importe_PEN: p.amount,
      Recibido_PEN: p.receivedAmount,
      Vuelto_PEN: p.changeAmount,
      Registrado_Por: p.registeredByName ?? '',
      Nota: p.referenceNote ?? '',
    }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentsData.length ? paymentsData : [{ Mensaje: 'Sin movimientos en el rango' }]), 'Ventas_Pagos');

  // Hoja 2: Ventas por Producto y Costo Estimado
  const prodStats = new Map<string, { Producto: string; Categoria: string; Cantidad: number; Venta_PEN: number; Costo_Est_PEN: number }>();
  const catMap = new Map(state.categories.map((c) => [c.id, c.name]));
  const prodMap = new Map(state.products.map((p) => [p.id, p]));
  const recipeMap = new Map(state.recipes.map((r) => [r.productId, r.estimatedCost]));

  for (const ord of state.orders.filter((o) => o.kitchenStatus !== 'ANULADO' && inRange(o.createdAt))) {
    for (const it of ord.items) {
      const prod = prodMap.get(it.productId);
      const catName = prod ? catMap.get(prod.categoryId) ?? 'Otro' : 'Otro';
      const unitCost = recipeMap.get(it.productId) ?? 0;
      const cur = prodStats.get(it.productId) ?? {
        Producto: it.productNameSnapshot,
        Categoria: catName,
        Cantidad: 0,
        Venta_PEN: 0,
        Costo_Est_PEN: 0,
      };
      cur.Cantidad += it.quantity;
      cur.Venta_PEN = Number((cur.Venta_PEN + it.unitPriceSnapshot * it.quantity).toFixed(2));
      cur.Costo_Est_PEN = Number((cur.Costo_Est_PEN + unitCost * it.quantity).toFixed(2));
      prodStats.set(it.productId, cur);
    }
  }
  const prodRows = Array.from(prodStats.values()).map((r) => ({
    ...r,
    Ganancia_Bruta_Est_PEN: Number((r.Venta_PEN - r.Costo_Est_PEN).toFixed(2)),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(prodRows.length ? prodRows : [{ Mensaje: 'Sin ventas en el rango' }]), 'Productos_Margen');

  // Hoja 3: Ventas por Mozo
  const waiterMap = new Map<string, { Mozo: string; Comandas: number; Total_Vendido_PEN: number }>();
  for (const ord of state.orders.filter((o) => o.kitchenStatus !== 'ANULADO' && inRange(o.createdAt))) {
    const cur = waiterMap.get(ord.waiterId) ?? { Mozo: ord.waiterName ?? 'Mozo', Comandas: 0, Total_Vendido_PEN: 0 };
    cur.Comandas += 1;
    cur.Total_Vendido_PEN = Number(
      (cur.Total_Vendido_PEN + ord.items.reduce((s, i) => s + i.unitPriceSnapshot * i.quantity, 0)).toFixed(2)
    );
    waiterMap.set(ord.waiterId, cur);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Array.from(waiterMap.values())), 'Ventas_Mozos');

  // Hoja 4: Consumo de Ingredientes, Compras y Mermas
  const movRows = state.movements
    .filter((m) => inRange(m.createdAt))
    .map((m) => ({
      Fecha: new Date(m.createdAt).toLocaleString('es-PE'),
      Ingrediente: m.ingredientName ?? '',
      Tipo: m.movementType,
      Delta: m.quantityDelta,
      Unidad: m.ingredientUnit ?? '',
      Stock_Resultante: m.stockAfter,
      Motivo: m.reason,
      Usuario: m.userName ?? '',
    }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(movRows.length ? movRows : [{ Mensaje: 'Sin movimientos' }]), 'Inventario_Consumo');

  const wasteRows = state.wasteRecords
    .filter((w) => inRange(w.createdAt))
    .map((w) => ({
      Fecha: new Date(w.createdAt).toLocaleString('es-PE'),
      Ingrediente: w.ingredientName ?? '',
      Cantidad: w.quantity,
      Perdida_Est_PEN: w.estimatedLoss,
      Motivo: w.reason,
    }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(wasteRows.length ? wasteRows : [{ Mensaje: 'Sin mermas' }]), 'Mermas');

  // Hoja 5: Cierres de Caja
  const cashRows = state.cashRegisters.map((c) => ({
    Apertura: new Date(c.openedAt).toLocaleString('es-PE'),
    Cierre: c.closedAt ? new Date(c.closedAt).toLocaleString('es-PE') : 'ABIERTA',
    Cajero: c.cashierName ?? '',
    Saldo_Inicial_PEN: c.openingBalance,
    Esperado_PEN: c.expectedClosingBalance,
    Declarado_PEN: c.declaredClosingBalance ?? '',
    Diferencia_PEN: c.difference ?? '',
    Estado: c.status,
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cashRows), 'Cierres_Caja');

  XLSX.writeFile(wb, `LaDieta_Reportes_${fromIso}_al_${toIso}.xlsx`);
}

export function exportReportsPdf(
  metrics: {
    totalSales: number;
    totalEstimatedCost: number;
    grossProfit: number;
    totalPurchases: number;
    totalWasteLoss: number;
    byMethod: Array<{ method: string; total: number }>;
    topProducts: Array<{ name: string; qty: number; revenue: number }>;
  },
  fromIso: string,
  toIso: string
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('LA DIETA – SALCHIPAPERÍA (Sicuani, Cusco)', 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Reporte Gerencial Consolidado · Del ${fromIso} al ${toIso}`, 14, y);
  y += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Resumen Financiero', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const summaryLines = [
    `Ingresos por Ventas: S/ ${metrics.totalSales.toFixed(2)}`,
    `Costo Estimado de Recetas: S/ ${metrics.totalEstimatedCost.toFixed(2)}`,
    `Ganancia Bruta Estimada: S/ ${metrics.grossProfit.toFixed(2)}`,
    `Compras de Insumos: S/ ${metrics.totalPurchases.toFixed(2)}`,
    `Pérdida por Mermas: S/ ${metrics.totalWasteLoss.toFixed(2)}`,
  ];
  for (const l of summaryLines) {
    doc.text(l, 16, y);
    y += 5.5;
  }

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Cobros por Método de Pago', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  for (const m of metrics.byMethod) {
    doc.text(`${m.method}: S/ ${m.total.toFixed(2)}`, 16, y);
    y += 5.5;
  }

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Top Productos Vendidos', 14, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  for (const p of metrics.topProducts.slice(0, 15)) {
    doc.text(`${p.qty}x ${p.name} — S/ ${p.revenue.toFixed(2)}`, 16, y);
    y += 5.5;
    if (y > 275) {
      doc.addPage();
      y = 16;
    }
  }

  doc.save(`LaDieta_Reporte_${fromIso}_al_${toIso}.pdf`);
}
