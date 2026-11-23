export type RoleName = 'ADMINISTRADOR' | 'MOZO' | 'COCINERO' | 'CAJERO';

export type TableStatus = 'LIBRE' | 'OCUPADA' | 'PENDIENTE_PAGO' | 'EN_LIMPIEZA';

export type KitchenStatus = 'NUEVO' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO' | 'ANULADO';

export type PaymentMethod = 'EFECTIVO' | 'YAPE' | 'PLIN' | 'TRANSFERENCIA' | 'COMBINADO';

export type ReservationMode = 'EN_MESA' | 'PARA_LLEVAR';

export type ReservationStatus = 'PENDIENTE' | 'EN_PREPARACION' | 'COMPLETADA' | 'CANCELADA';

export interface Role {
  id: string;
  name: RoleName;
  permissions: string[];
}

export interface User {
  id: string;
  roleId: string;
  roleName: RoleName;
  permissions: string[];
  fullName: string;
  username: string;
  isActive: boolean;
  updatedAt: string;
}

export interface DiningTable {
  id: string;
  number: number;
  label: string;
  status: TableStatus;
  activeAccountId: string | null;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  subtitle: string | null;
  sortOrder: number;
  isActive: boolean;
  updatedAt: string;
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  isAvailable: boolean;
  requiresKitchen: boolean;
  version: number;
  updatedAt: string;
}

export interface AccountGuest {
  id: string;
  accountId: string;
  guestName: string;
  totalAssigned: number;
  paidAmount: number;
  isSettled: boolean;
}

export interface Account {
  id: string;
  tableId: string | null;
  isTakeaway: boolean;
  mainCustomerName: string;
  waiterId: string;
  waiterName?: string;
  status: 'ABIERTA' | 'PENDIENTE_PAGO' | 'CERRADA' | 'ANULADA';
  totalAmount: number;
  paidAmount: number;
  openedAt: string;
  closedAt: string | null;
  guests?: AccountGuest[];
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  accountGuestId: string | null;
  productNameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  notes: string;
}

export interface Order {
  id: string;
  orderCode: string;
  accountId: string;
  tableId: string | null;
  tableLabel?: string;
  isTakeaway?: boolean;
  waiterId: string;
  waiterName?: string;
  deliveryWaiterId: string | null;
  deliveryWaiterName?: string | null;
  deliveryDestination: string | null;
  waiterConfirmedAt: string | null;
  customerName: string;
  kitchenStatus: KitchenStatus;
  inventoryDeducted: boolean;
  cancellationReason: string | null;
  createdAt: string;
  prepStartedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  items: OrderItem[];
}

export interface CashRegister {
  id: string;
  cashierId: string;
  cashierName?: string;
  openingBalance: number;
  expectedClosingBalance: number;
  declaredClosingBalance: number | null;
  difference: number | null;
  status: 'ABIERTA' | 'CERRADA';
  openedAt: string;
  closedAt: string | null;
}

export interface Payment {
  id: string;
  cashRegisterId: string;
  accountId: string | null;
  accountGuestId: string | null;
  movementType: 'INGRESO_VENTA' | 'INGRESO_EXTRA' | 'GASTO_AUTORIZADO';
  method: PaymentMethod;
  amount: number;
  receivedAmount: number;
  changeAmount: number;
  referenceNote: string | null;
  validationCode: string | null;
  proofImageUrl: string | null;
  registeredByUserId: string;
  registeredByName?: string;
  createdAt: string;
}

export interface InternalReceipt {
  id: string;
  receiptNumber: string;
  accountId: string;
  paymentId: string;
  payloadJson: string;
  issuedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  rucOrDni: string | null;
  phone: string | null;
}

export interface Ingredient {
  id: string;
  category: string;
  name: string;
  unit: 'kg' | 'g' | 'l' | 'ml' | 'unidad';
  currentStock: number;
  minStock: number;
  lastPurchasePrice: number;
  averageUnitCost: number;
  supplierId: string | null;
  expirationDate: string | null;
  updatedAt: string;
}

export interface RecipeItem {
  id: string;
  recipeId: string;
  ingredientId: string;
  ingredientName?: string;
  ingredientUnit?: string;
  ingredientCost?: number;
  quantity: number;
}

export interface Recipe {
  id: string;
  productId: string;
  estimatedCost: number;
  updatedAt: string;
  items: RecipeItem[];
}

export interface Purchase {
  id: string;
  supplierId: string;
  supplierName?: string;
  ingredientId: string;
  ingredientName?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalAmount: number;
  registeredByUserId: string;
  purchasedAt: string;
}

export interface InventoryMovement {
  id: string;
  ingredientId: string;
  ingredientName?: string;
  ingredientUnit?: string;
  movementType: 'COMPRA' | 'CONSUMO_VENTA' | 'REVERSION_ANULACION' | 'AJUSTE' | 'MERMA' | 'DEVOLUCION';
  quantityDelta: number;
  stockAfter: number;
  orderId: string | null;
  userId: string;
  userName?: string;
  reason: string;
  createdAt: string;
}

export interface WasteRecord {
  id: string;
  ingredientId: string;
  ingredientName?: string;
  orderId: string | null;
  quantity: number;
  estimatedLoss: number;
  reason: string;
  registeredByUserId: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName?: string;
  action: string;
  entityName: string;
  entityId: string;
  detailsJson: string;
  createdAt: string;
}

export interface ReservationPreOrderItem {
  productId: string;
  productName: string;
  quantity: number;
  notes?: string;
}

export interface TableReservation {
  id: string;
  tableId: string | null;
  tableLabel?: string | null;
  customerName: string;
  customerPhone: string | null;
  serviceMode: ReservationMode;
  reservationDate: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  status: ReservationStatus;
  notes: string;
  preOrderItems: ReservationPreOrderItem[];
  linkedOrderId: string | null;
  createdByUserId: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PosBootstrapState {
  roles: Role[];
  users: User[];
  tables: DiningTable[];
  reservations: TableReservation[];
  customers: Customer[];
  categories: Category[];
  products: Product[];
  accounts: Account[];
  orders: Order[];
  cashRegisters: CashRegister[];
  payments: Payment[];
  receipts: InternalReceipt[];
  suppliers: Supplier[];
  ingredients: Ingredient[];
  recipes: Recipe[];
  purchases: Purchase[];
  movements: InventoryMovement[];
  wasteRecords: WasteRecord[];
  auditLogs: AuditLog[];
  serverTime: string;
}

export interface OutboxMutation {
  id: string; // UUID idempotency key
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body: unknown;
  description: string;
  createdAt: string;
  retryCount: number;
  lastError?: string;
}
