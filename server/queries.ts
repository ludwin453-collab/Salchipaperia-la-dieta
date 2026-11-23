import crypto from 'node:crypto';
import { db } from './db.ts';
import type {
  Account,
  AccountGuest,
  AuditLog,
  CashRegister,
  Category,
  Customer,
  DiningTable,
  Ingredient,
  InternalReceipt,
  InventoryMovement,
  Order,
  OrderItem,
  Payment,
  PosBootstrapState,
  Product,
  Purchase,
  Recipe,
  RecipeItem,
  ReservationPreOrderItem,
  Role,
  RoleName,
  Supplier,
  TableReservation,
  User,
  WasteRecord,
} from '../src/types/pos.ts';

export function buildBootstrapState(): PosBootstrapState {
  const rolesRows = db.prepare('SELECT * FROM roles').all() as Array<{
    id: string;
    name: RoleName;
    permissions_json: string;
  }>;
  const roles: Role[] = rolesRows.map((r) => ({
    id: r.id,
    name: r.name,
    permissions: JSON.parse(r.permissions_json) as string[],
  }));

  const roleMap = new Map(roles.map((r) => [r.id, r]));

  const usersRows = db.prepare('SELECT * FROM users ORDER BY full_name ASC').all() as Array<{
    id: string;
    role_id: string;
    full_name: string;
    username: string;
    is_active: number;
    updated_at: string;
  }>;
  const users: User[] = usersRows.map((u) => {
    const role = roleMap.get(u.role_id);
    return {
      id: u.id,
      roleId: u.role_id,
      roleName: role?.name ?? 'MOZO',
      permissions: role?.permissions ?? [],
      fullName: u.full_name,
      username: u.username,
      isActive: u.is_active === 1,
      updatedAt: u.updated_at,
    };
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const tablesRows = db.prepare('SELECT * FROM dining_tables ORDER BY number ASC').all() as Array<{
    id: string;
    number: number;
    label: string;
    status: DiningTable['status'];
    active_account_id: string | null;
    updated_at: string;
  }>;
  const tables: DiningTable[] = tablesRows.map((t) => ({
    id: t.id,
    number: t.number,
    label: t.label,
    status: t.status,
    activeAccountId: t.active_account_id,
    updatedAt: t.updated_at,
  }));
  const tableMap = new Map(tables.map((t) => [t.id, t]));

  const customersRows = db.prepare('SELECT * FROM customers ORDER BY name ASC').all() as Array<{
    id: string;
    name: string;
    phone: string | null;
    updated_at: string;
  }>;
  const customers: Customer[] = customersRows.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    updatedAt: c.updated_at,
  }));

  const categoriesRows = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, name ASC').all() as Array<{
    id: string;
    name: string;
    subtitle: string | null;
    sort_order: number;
    is_active: number;
    updated_at: string;
  }>;
  const categories: Category[] = categoriesRows.map((c) => ({
    id: c.id,
    name: c.name,
    subtitle: c.subtitle,
    sortOrder: c.sort_order,
    isActive: c.is_active === 1,
    updatedAt: c.updated_at,
  }));

  const productsRows = db.prepare('SELECT * FROM products ORDER BY name ASC').all() as Array<{
    id: string;
    category_id: string;
    name: string;
    description: string;
    price: number;
    image_url: string | null;
    is_available: number;
    requires_kitchen: number;
    version: number;
    updated_at: string;
  }>;
  const products: Product[] = productsRows.map((p) => ({
    id: p.id,
    categoryId: p.category_id,
    name: p.name,
    description: p.description,
    price: p.price,
    imageUrl: p.image_url,
    isAvailable: p.is_available === 1,
    requiresKitchen: p.requires_kitchen === 1,
    version: p.version,
    updatedAt: p.updated_at,
  }));

  const guestsRows = db.prepare('SELECT * FROM account_guests').all() as Array<{
    id: string;
    account_id: string;
    guest_name: string;
    total_assigned: number;
    paid_amount: number;
    is_settled: number;
  }>;
  const guestsByAccount = new Map<string, AccountGuest[]>();
  for (const g of guestsRows) {
    const list = guestsByAccount.get(g.account_id) ?? [];
    list.push({
      id: g.id,
      accountId: g.account_id,
      guestName: g.guest_name,
      totalAssigned: g.total_assigned,
      paidAmount: g.paid_amount,
      isSettled: g.is_settled === 1,
    });
    guestsByAccount.set(g.account_id, list);
  }

  const accountsRows = db.prepare('SELECT * FROM accounts ORDER BY opened_at DESC').all() as Array<{
    id: string;
    table_id: string | null;
    is_takeaway: number;
    main_customer_name: string;
    waiter_id: string;
    status: Account['status'];
    total_amount: number;
    paid_amount: number;
    opened_at: string;
    closed_at: string | null;
  }>;
  const accounts: Account[] = accountsRows.map((a) => ({
    id: a.id,
    tableId: a.table_id,
    isTakeaway: a.is_takeaway === 1,
    mainCustomerName: a.main_customer_name,
    waiterId: a.waiter_id,
    waiterName: userMap.get(a.waiter_id)?.fullName ?? 'Mozo',
    status: a.status,
    totalAmount: a.total_amount,
    paidAmount: a.paid_amount,
    openedAt: a.opened_at,
    closedAt: a.closed_at,
    guests: guestsByAccount.get(a.id) ?? [],
  }));
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const orderItemsRows = db.prepare('SELECT * FROM order_items').all() as Array<{
    id: string;
    order_id: string;
    product_id: string;
    account_guest_id: string | null;
    product_name_snapshot: string;
    unit_price_snapshot: number;
    quantity: number;
    notes: string;
  }>;
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const it of orderItemsRows) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push({
      id: it.id,
      orderId: it.order_id,
      productId: it.product_id,
      accountGuestId: it.account_guest_id,
      productNameSnapshot: it.product_name_snapshot,
      unitPriceSnapshot: it.unit_price_snapshot,
      quantity: it.quantity,
      notes: it.notes,
    });
    itemsByOrder.set(it.order_id, list);
  }

  // FIFO order: oldest first for Kitchen!
  const ordersRows = db.prepare('SELECT * FROM orders ORDER BY created_at ASC').all() as Array<{
    id: string;
    order_code: string;
    account_id: string;
    table_id: string | null;
    waiter_id: string;
    delivery_waiter_id: string | null;
    delivery_destination: string | null;
    waiter_confirmed_at: string | null;
    customer_name: string;
    kitchen_status: Order['kitchenStatus'];
    inventory_deducted: number;
    cancellation_reason: string | null;
    created_at: string;
    prep_started_at: string | null;
    ready_at: string | null;
    delivered_at: string | null;
  }>;
  const orders: Order[] = ordersRows.map((o) => {
    const acc = accountMap.get(o.account_id);
    const tbl = o.table_id ? tableMap.get(o.table_id) : undefined;
    return {
      id: o.id,
      orderCode: o.order_code,
      accountId: o.account_id,
      tableId: o.table_id,
      tableLabel: tbl ? tbl.label : 'PARA LLEVAR',
      isTakeaway: acc?.isTakeaway ?? !o.table_id,
      waiterId: o.waiter_id,
      waiterName: userMap.get(o.waiter_id)?.fullName ?? 'Mozo',
      deliveryWaiterId: o.delivery_waiter_id ?? null,
      deliveryWaiterName: o.delivery_waiter_id ? (userMap.get(o.delivery_waiter_id)?.fullName ?? null) : null,
      deliveryDestination: o.delivery_destination ?? (tbl ? tbl.label : null),
      waiterConfirmedAt: o.waiter_confirmed_at ?? null,
      customerName: o.customer_name,
      kitchenStatus: o.kitchen_status,
      inventoryDeducted: o.inventory_deducted === 1,
      cancellationReason: o.cancellation_reason,
      createdAt: o.created_at,
      prepStartedAt: o.prep_started_at,
      readyAt: o.ready_at,
      deliveredAt: o.delivered_at,
      items: itemsByOrder.get(o.id) ?? [],
    };
  });

  const cashRegistersRows = db.prepare('SELECT * FROM cash_registers ORDER BY opened_at DESC').all() as Array<{
    id: string;
    cashier_id: string;
    opening_balance: number;
    expected_closing_balance: number;
    declared_closing_balance: number | null;
    difference: number | null;
    status: CashRegister['status'];
    opened_at: string;
    closed_at: string | null;
  }>;
  const cashRegisters: CashRegister[] = cashRegistersRows.map((c) => ({
    id: c.id,
    cashierId: c.cashier_id,
    cashierName: userMap.get(c.cashier_id)?.fullName ?? 'Cajero',
    openingBalance: c.opening_balance,
    expectedClosingBalance: c.expected_closing_balance,
    declaredClosingBalance: c.declared_closing_balance,
    difference: c.difference,
    status: c.status,
    openedAt: c.opened_at,
    closedAt: c.closed_at,
  }));

  const paymentsRows = db.prepare('SELECT * FROM payments ORDER BY created_at DESC').all() as Array<{
    id: string;
    cash_register_id: string;
    account_id: string | null;
    account_guest_id: string | null;
    movement_type: Payment['movementType'];
    method: Payment['method'];
    amount: number;
    received_amount: number;
    change_amount: number;
    reference_note: string | null;
    validation_code: string | null;
    proof_image_url: string | null;
    registered_by_user_id: string;
    created_at: string;
  }>;
  const payments: Payment[] = paymentsRows.map((p) => ({
    id: p.id,
    cashRegisterId: p.cash_register_id,
    accountId: p.account_id,
    accountGuestId: p.account_guest_id,
    movementType: p.movement_type,
    method: p.method,
    amount: p.amount,
    receivedAmount: p.received_amount,
    changeAmount: p.change_amount,
    referenceNote: p.reference_note,
    validationCode: p.validation_code ?? null,
    proofImageUrl: p.proof_image_url ?? null,
    registeredByUserId: p.registered_by_user_id,
    registeredByName: userMap.get(p.registered_by_user_id)?.fullName ?? 'Usuario',
    createdAt: p.created_at,
  }));

  const receiptsRows = db.prepare('SELECT * FROM internal_receipts ORDER BY issued_at DESC').all() as Array<{
    id: string;
    receipt_number: string;
    account_id: string;
    payment_id: string;
    payload_json: string;
    issued_at: string;
  }>;
  const receipts: InternalReceipt[] = receiptsRows.map((r) => ({
    id: r.id,
    receiptNumber: r.receipt_number,
    accountId: r.account_id,
    paymentId: r.payment_id,
    payloadJson: r.payload_json,
    issuedAt: r.issued_at,
  }));

  const suppliersRows = db.prepare('SELECT * FROM suppliers ORDER BY name ASC').all() as Array<{
    id: string;
    name: string;
    ruc_or_dni: string | null;
    phone: string | null;
  }>;
  const suppliers: Supplier[] = suppliersRows.map((s) => ({
    id: s.id,
    name: s.name,
    rucOrDni: s.ruc_or_dni,
    phone: s.phone,
  }));
  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));

  const ingredientsRows = db.prepare('SELECT * FROM ingredients ORDER BY category ASC, name ASC').all() as Array<{
    id: string;
    category: string;
    name: string;
    unit: Ingredient['unit'];
    current_stock: number;
    min_stock: number;
    last_purchase_price: number;
    average_unit_cost: number;
    supplier_id: string | null;
    expiration_date: string | null;
    updated_at: string;
  }>;
  const ingredients: Ingredient[] = ingredientsRows.map((i) => ({
    id: i.id,
    category: i.category,
    name: i.name,
    unit: i.unit,
    currentStock: i.current_stock,
    minStock: i.min_stock,
    lastPurchasePrice: i.last_purchase_price,
    averageUnitCost: i.average_unit_cost,
    supplierId: i.supplier_id,
    expirationDate: i.expiration_date,
    updatedAt: i.updated_at,
  }));
  const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

  const recipeItemsRows = db.prepare('SELECT * FROM recipe_items').all() as Array<{
    id: string;
    recipe_id: string;
    ingredient_id: string;
    quantity: number;
  }>;
  const rItemsByRecipe = new Map<string, RecipeItem[]>();
  for (const ri of recipeItemsRows) {
    const ing = ingredientMap.get(ri.ingredient_id);
    const list = rItemsByRecipe.get(ri.recipe_id) ?? [];
    list.push({
      id: ri.id,
      recipeId: ri.recipe_id,
      ingredientId: ri.ingredient_id,
      ingredientName: ing?.name ?? 'Ingrediente',
      ingredientUnit: ing?.unit ?? 'unidad',
      ingredientCost: ing?.averageUnitCost ?? 0,
      quantity: ri.quantity,
    });
    rItemsByRecipe.set(ri.recipe_id, list);
  }

  const recipesRows = db.prepare('SELECT * FROM recipes').all() as Array<{
    id: string;
    product_id: string;
    estimated_cost: number;
    updated_at: string;
  }>;
  const recipes: Recipe[] = recipesRows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    estimatedCost: r.estimated_cost,
    updatedAt: r.updated_at,
    items: rItemsByRecipe.get(r.id) ?? [],
  }));

  const purchasesRows = db.prepare('SELECT * FROM purchases ORDER BY purchased_at DESC').all() as Array<{
    id: string;
    supplier_id: string;
    ingredient_id: string;
    quantity: number;
    unit: string;
    unit_price: number;
    total_amount: number;
    registered_by_user_id: string;
    purchased_at: string;
  }>;
  const purchases: Purchase[] = purchasesRows.map((p) => ({
    id: p.id,
    supplierId: p.supplier_id,
    supplierName: supplierMap.get(p.supplier_id)?.name ?? 'Proveedor',
    ingredientId: p.ingredient_id,
    ingredientName: ingredientMap.get(p.ingredient_id)?.name ?? 'Ingrediente',
    quantity: p.quantity,
    unit: p.unit,
    unitPrice: p.unit_price,
    totalAmount: p.total_amount,
    registeredByUserId: p.registered_by_user_id,
    purchasedAt: p.purchased_at,
  }));

  const movementsRows = db.prepare('SELECT * FROM inventory_movements ORDER BY created_at DESC LIMIT 300').all() as Array<{
    id: string;
    ingredient_id: string;
    movement_type: InventoryMovement['movementType'];
    quantity_delta: number;
    stock_after: number;
    order_id: string | null;
    user_id: string;
    reason: string;
    created_at: string;
  }>;
  const movements: InventoryMovement[] = movementsRows.map((m) => {
    const ing = ingredientMap.get(m.ingredient_id);
    return {
      id: m.id,
      ingredientId: m.ingredient_id,
      ingredientName: ing?.name ?? 'Ingrediente',
      ingredientUnit: ing?.unit ?? 'unidad',
      movementType: m.movement_type,
      quantityDelta: m.quantity_delta,
      stockAfter: m.stock_after,
      orderId: m.order_id,
      userId: m.user_id,
      userName: userMap.get(m.user_id)?.fullName ?? 'Sistema',
      reason: m.reason,
      createdAt: m.created_at,
    };
  });

  const wasteRows = db.prepare('SELECT * FROM waste_records ORDER BY created_at DESC LIMIT 200').all() as Array<{
    id: string;
    ingredient_id: string;
    order_id: string | null;
    quantity: number;
    estimated_loss: number;
    reason: string;
    registered_by_user_id: string;
    created_at: string;
  }>;
  const wasteRecords: WasteRecord[] = wasteRows.map((w) => ({
    id: w.id,
    ingredientId: w.ingredient_id,
    ingredientName: ingredientMap.get(w.ingredient_id)?.name ?? 'Ingrediente',
    orderId: w.order_id,
    quantity: w.quantity,
    estimatedLoss: w.estimated_loss,
    reason: w.reason,
    registeredByUserId: w.registered_by_user_id,
    createdAt: w.created_at,
  }));

  const auditRows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all() as Array<{
    id: string;
    user_id: string;
    action: string;
    entity_name: string;
    entity_id: string;
    details_json: string;
    created_at: string;
  }>;
  const auditLogs: AuditLog[] = auditRows.map((a) => ({
    id: a.id,
    userId: a.user_id,
    userName: userMap.get(a.user_id)?.fullName ?? 'Sistema',
    action: a.action,
    entityName: a.entity_name,
    entityId: a.entity_id,
    detailsJson: a.details_json,
    createdAt: a.created_at,
  }));

  const reservationsRows = db
    .prepare('SELECT * FROM table_reservations ORDER BY reservation_date ASC, start_time ASC')
    .all() as Array<{
    id: string;
    table_id: string | null;
    customer_name: string;
    customer_phone: string | null;
    service_mode: TableReservation['serviceMode'];
    reservation_date: string;
    start_time: string;
    end_time: string;
    duration_hours: number;
    status: TableReservation['status'];
    notes: string;
    pre_order_items_json: string | null;
    linked_order_id: string | null;
    created_by_user_id: string;
    created_at: string;
    updated_at: string;
  }>;
  const reservations: TableReservation[] = reservationsRows.map((r) => {
    let parsedItems: ReservationPreOrderItem[] = [];
    if (r.pre_order_items_json) {
      try {
        parsedItems = JSON.parse(r.pre_order_items_json) as ReservationPreOrderItem[];
      } catch {
        parsedItems = [];
      }
    }
    return {
      id: r.id,
      tableId: r.table_id,
      tableLabel: r.table_id ? (tableMap.get(r.table_id)?.label ?? 'Mesa') : null,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      serviceMode: r.service_mode,
      reservationDate: r.reservation_date,
      startTime: r.start_time,
      endTime: r.end_time,
      durationHours: r.duration_hours,
      status: r.status,
      notes: r.notes,
      preOrderItems: parsedItems,
      linkedOrderId: r.linked_order_id,
      createdByUserId: r.created_by_user_id,
      createdByName: userMap.get(r.created_by_user_id)?.fullName ?? 'Personal',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });

  return {
    roles,
    users,
    tables,
    reservations,
    customers,
    categories,
    products,
    accounts,
    orders,
    cashRegisters,
    payments,
    receipts,
    suppliers,
    ingredients,
    recipes,
    purchases,
    movements,
    wasteRecords,
    auditLogs,
    serverTime: new Date().toISOString(),
  };
}

export function writeAuditLog(
  userId: string,
  action: string,
  entityName: string,
  entityId: string,
  details: Record<string, unknown>
): void {
  db.prepare(
    'INSERT INTO audit_logs (id, user_id, action, entity_name, entity_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), userId, action, entityName, entityId, JSON.stringify(details), new Date().toISOString());
}

export function recalculateAllRecipeCosts(): void {
  const recipes = db.prepare('SELECT id FROM recipes').all() as Array<{ id: string }>;
  const itemsStmt = db.prepare(`
    SELECT ri.quantity, i.average_unit_cost
    FROM recipe_items ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = ?
  `);
  const updateStmt = db.prepare('UPDATE recipes SET estimated_cost = ?, updated_at = ? WHERE id = ?');
  const now = new Date().toISOString();

  for (const r of recipes) {
    const items = itemsStmt.all(r.id) as Array<{ quantity: number; average_unit_cost: number }>;
    const cost = items.reduce((sum, it) => sum + it.quantity * it.average_unit_cost, 0);
    updateStmt.run(Number(cost.toFixed(4)), now, r.id);
  }
}
