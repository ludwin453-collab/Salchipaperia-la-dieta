import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { db, hashPassword, initDatabase } from './server/db.ts';
import { buildBootstrapState, recalculateAllRecipeCosts, writeAuditLog } from './server/queries.ts';
import type { RoleName } from './src/types/pos.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '4mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastEvent(event: string, payload: Record<string, unknown> = {}): void {
  const message = JSON.stringify({ event, payload, ts: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

interface AuthActor {
  id: string;
  fullName: string;
  roleName: RoleName;
  permissions: string[];
}

function getActor(req: express.Request): AuthActor | null {
  const userId = req.header('x-user-id');
  if (!userId) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.full_name, u.is_active, r.name as role_name, r.permissions_json
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = ?`
    )
    .get(userId) as
    | { id: string; full_name: string; is_active: number; role_name: RoleName; permissions_json: string }
    | undefined;
  if (!row || row.is_active !== 1) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    roleName: row.role_name,
    permissions: JSON.parse(row.permissions_json) as string[],
  };
}

function requirePermission(perm: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const actor = getActor(req);
    if (!actor) {
      res.status(401).json({ error: 'Sesión no válida o usuario inactivo.' });
      return;
    }
    if (!actor.permissions.includes('ALL') && !actor.permissions.includes(perm)) {
      res.status(403).json({ error: `Permiso denegado (${perm}) para el rol ${actor.roleName}.` });
      return;
    }
    (req as express.Request & { actor: AuthActor }).actor = actor;
    next();
  };
}

function getActorFromReq(req: express.Request): AuthActor {
  return (req as express.Request & { actor: AuthActor }).actor;
}

function checkIdempotency(key: string | undefined): { exists: boolean; response?: unknown } {
  if (!key) return { exists: false };
  const row = db
    .prepare('SELECT response_json FROM idempotency_keys WHERE idempotency_key = ?')
    .get(key) as { response_json: string | null } | undefined;
  if (!row) return { exists: false };
  return { exists: true, response: row.response_json ? JSON.parse(row.response_json) : { status: 'ALREADY_PROCESSED' } };
}

function saveIdempotency(key: string | undefined, entityName: string, entityId: string, responseObj: unknown): void {
  if (!key) return;
  db.prepare(
    'INSERT OR IGNORE INTO idempotency_keys (idempotency_key, entity_name, entity_id, response_json, processed_at) VALUES (?, ?, ?, ?, ?)'
  ).run(key, entityName, entityId, JSON.stringify(responseObj), new Date().toISOString());
}

function getSystemSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function createGateToken(): string {
  const secret = getSystemSetting('app_gate_secret', 'LA_DIETA_FALLBACK_SECRET');
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `${exp}.${nonce}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyGateToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp <= Date.now() || !nonce || !sig) return false;
  const secret = getSystemSetting('app_gate_secret', 'LA_DIETA_FALLBACK_SECRET');
  const expectedSig = crypto.createHmac('sha256', secret).update(`${expStr}.${nonce}`).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expectedSig, 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 1. Auth: Puerta general + lista de trabajadores + login individual
app.post('/api/auth/app-gate', (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() || !password) {
    res.status(400).json({ error: 'Ingresa el usuario y contraseña general de acceso.' });
    return;
  }

  const gateUser = getSystemSetting('app_gate_username', 'admin');
  const gatePassHash = getSystemSetting('app_gate_password_hash', hashPassword('admin'));

  if (
    username.trim().toLowerCase() !== gateUser.trim().toLowerCase() ||
    hashPassword(password) !== gatePassHash
  ) {
    res.status(401).json({ error: 'Usuario o contraseña general incorrectos.' });
    return;
  }

  const gateToken = createGateToken();
  res.json({ gateToken });
});

app.get('/api/auth/workers', (req, res) => {
  const gateToken = req.header('x-app-gate-token');
  if (!verifyGateToken(gateToken)) {
    res.status(401).json({ error: 'Acceso general requerido antes de ver la lista de trabajadores.' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT u.id, u.full_name, u.username, r.name as role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.is_active = 1
       ORDER BY
         CASE r.name
           WHEN 'ADMINISTRADOR' THEN 1
           WHEN 'CAJERO' THEN 2
           WHEN 'COCINERO' THEN 3
           WHEN 'MOZO' THEN 4
           ELSE 5
         END ASC,
         u.full_name ASC`
    )
    .all() as Array<{ id: string; full_name: string; username: string; role_name: RoleName }>;

  res.json({
    workers: rows.map((w) => ({
      id: w.id,
      fullName: w.full_name,
      username: w.username,
      roleName: w.role_name,
    })),
  });
});

app.post('/api/auth/login', (req, res) => {
  const gateToken = req.header('x-app-gate-token');
  if (!verifyGateToken(gateToken)) {
    res.status(401).json({ error: 'Debes ingresar primero la contraseña general del aplicativo.' });
    return;
  }

  const { userId, username, password } = req.body as {
    userId?: string;
    username?: string;
    password?: string;
  };
  if ((!userId && !username) || !password) {
    res.status(400).json({ error: 'Selecciona tu usuario e ingresa tu contraseña personal.' });
    return;
  }

  const baseQuery = `SELECT u.id, u.role_id, u.full_name, u.username, u.password_hash, u.is_active, u.updated_at,
              r.name as role_name, r.permissions_json
       FROM users u
       JOIN roles r ON r.id = u.role_id`;
  const row = (
    userId
      ? db.prepare(`${baseQuery} WHERE u.id = ?`).get(userId)
      : db.prepare(`${baseQuery} WHERE lower(u.username) = lower(?)`).get(username!.trim())
  ) as
    | {
        id: string;
        role_id: string;
        full_name: string;
        username: string;
        password_hash: string;
        is_active: number;
        updated_at: string;
        role_name: RoleName;
        permissions_json: string;
      }
    | undefined;

  if (!row || row.is_active !== 1 || row.password_hash !== hashPassword(password)) {
    res.status(401).json({ error: 'Contraseña incorrecta para este trabajador.' });
    return;
  }

  writeAuditLog(row.id, 'LOGIN', 'users', row.id, { username: row.username, role: row.role_name });

  res.json({
    user: {
      id: row.id,
      roleId: row.role_id,
      roleName: row.role_name,
      permissions: JSON.parse(row.permissions_json) as string[],
      fullName: row.full_name,
      username: row.username,
      isActive: row.is_active === 1,
      updatedAt: row.updated_at,
    },
  });
});

// 2. Estado completo sincronizado
app.get('/api/state', (req, res) => {
  const actor = getActor(req);
  if (!actor) {
    res.status(401).json({ error: 'No autenticado.' });
    return;
  }
  res.json(buildBootstrapState());
});

// 3. Crear pedido / comanda (Mozo, Cajero o Admin)
app.post('/api/orders', requirePermission('ORDERS_CREATE'), (req, res) => {
  const actor = getActorFromReq(req);
  const idempotencyKey = req.header('idempotency-key');
  const idem = checkIdempotency(idempotencyKey);
  if (idem.exists) {
    res.status(200).json(idem.response);
    return;
  }

  const body = req.body as {
    id?: string;
    orderCode?: string;
    accountId?: string | null;
    tableId?: string | null;
    isTakeaway?: boolean;
    deliveryDestination?: string | null;
    customerName?: string;
    customerPhone?: string | null;
    items: Array<{
      id?: string;
      productId: string;
      quantity: number;
      notes?: string;
      accountGuestId?: string | null;
    }>;
  };

  if (!body.items || body.items.length === 0) {
    res.status(400).json({ error: 'El pedido debe tener al menos un producto.' });
    return;
  }

  const now = new Date().toISOString();
  const orderId = body.id ?? crypto.randomUUID();
  const customerName = (body.customerName ?? '').trim() || 'Cliente General';
  const isTakeaway = Boolean(body.isTakeaway) || !body.tableId;

  try {
    const result = db.transaction(() => {
      // Registrar cliente si se especificó nombre propio
      if (customerName !== 'Cliente General') {
        const existingCustomer = db
          .prepare('SELECT id FROM customers WHERE lower(name) = lower(?)')
          .get(customerName) as { id: string } | undefined;
        if (!existingCustomer) {
          db.prepare('INSERT INTO customers (id, name, phone, updated_at) VALUES (?, ?, ?, ?)').run(
            crypto.randomUUID(),
            customerName,
            body.customerPhone ?? null,
            now
          );
        }
      }

      // Calcular precios reales desde la BD (jamás confiar en precios enviados por el cliente)
      let addedTotal = 0;
      const resolvedItems: Array<{
        id: string;
        productId: string;
        name: string;
        price: number;
        quantity: number;
        notes: string;
        requiresKitchen: boolean;
        accountGuestId: string | null;
      }> = [];

      const prodStmt = db.prepare('SELECT id, name, price, is_available, requires_kitchen FROM products WHERE id = ?');
      for (const item of body.items) {
        const prod = prodStmt.get(item.productId) as
          | { id: string; name: string; price: number; is_available: number; requires_kitchen: number }
          | undefined;
        if (!prod) throw new Error('Producto no encontrado en la carta.');
        if (prod.is_available !== 1) throw new Error(`El producto "${prod.name}" no está disponible.`);
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('Cantidad inválida.');

        addedTotal += prod.price * item.quantity;
        resolvedItems.push({
          id: item.id ?? crypto.randomUUID(),
          productId: prod.id,
          name: prod.name,
          price: prod.price,
          quantity: item.quantity,
          notes: (item.notes ?? '').trim(),
          requiresKitchen: prod.requires_kitchen === 1,
          accountGuestId: item.accountGuestId ?? null,
        });
      }

      let accountId = body.accountId ?? null;
      if (!accountId && body.tableId) {
        const tbl = db
          .prepare('SELECT active_account_id FROM dining_tables WHERE id = ?')
          .get(body.tableId) as { active_account_id: string | null } | undefined;
        if (tbl?.active_account_id) {
          accountId = tbl.active_account_id;
        }
      }

      if (accountId) {
        const acc = db
          .prepare('SELECT id, total_amount, version, status FROM accounts WHERE id = ?')
          .get(accountId) as { id: string; total_amount: number; version: number; status: string } | undefined;
        if (!acc || acc.status === 'CERRADA' || acc.status === 'ANULADA') {
          accountId = null;
        } else {
          db.prepare('UPDATE accounts SET total_amount = ?, version = ?, updated_at = ? WHERE id = ?').run(
            Number((acc.total_amount + addedTotal).toFixed(2)),
            acc.version + 1,
            now,
            accountId
          );
        }
      }

      if (!accountId) {
        accountId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO accounts (id, table_id, is_takeaway, main_customer_name, waiter_id, status, total_amount, paid_amount, opened_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'ABIERTA', ?, 0, ?, ?)`
        ).run(accountId, body.tableId ?? null, isTakeaway ? 1 : 0, customerName, actor.id, Number(addedTotal.toFixed(2)), now, now);
      }

      if (body.tableId) {
        db.prepare(
          "UPDATE dining_tables SET status = 'OCUPADA', active_account_id = ?, updated_at = ? WHERE id = ?"
        ).run(accountId, now, body.tableId);
      }

      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM orders').get() as { cnt: number };
      const orderCode =
        body.orderCode ??
        `LD-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(countRow.cnt + 1).padStart(4, '0')}`;

      const hasKitchenItems = resolvedItems.some((i) => i.requiresKitchen);
      const initialKitchenStatus = hasKitchenItems ? 'NUEVO' : 'ENTREGADO';
      const tableRowForDest = body.tableId
        ? (db.prepare('SELECT label FROM dining_tables WHERE id = ?').get(body.tableId) as { label: string } | undefined)
        : undefined;
      const defaultDest = tableRowForDest?.label ?? 'PARA LLEVAR - Mostrador';
      const deliveryDestination = (body.deliveryDestination ?? '').trim() || defaultDest;

      db.prepare(
        `INSERT INTO orders (id, order_code, account_id, table_id, waiter_id, delivery_destination, customer_name, kitchen_status, inventory_deducted, created_at, delivered_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(
        orderId,
        orderCode,
        accountId,
        body.tableId ?? null,
        actor.id,
        deliveryDestination,
        customerName,
        initialKitchenStatus,
        now,
        hasKitchenItems ? null : now,
        now
      );

      const insertItemStmt = db.prepare(
        `INSERT INTO order_items (id, order_id, product_id, account_guest_id, product_name_snapshot, unit_price_snapshot, quantity, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of resolvedItems) {
        insertItemStmt.run(
          item.id,
          orderId,
          item.productId,
          item.accountGuestId,
          item.name,
          item.price,
          item.quantity,
          item.notes,
          now
        );
        if (item.accountGuestId) {
          db.prepare(
            'UPDATE account_guests SET total_assigned = total_assigned + ?, updated_at = ? WHERE id = ?'
          ).run(Number((item.price * item.quantity).toFixed(2)), now, item.accountGuestId);
        }
      }

      // Si el pedido tiene productos sin cocina (ej. bebidas directas) con receta configurada, descontar automáticamente
      if (!hasKitchenItems) {
        deductInventoryForOrderInternal(orderId, orderCode, actor.id, now);
      }

      const responseObj = { status: 'CREATED', orderId, orderCode, accountId };
      saveIdempotency(idempotencyKey, 'ORDER', orderId, responseObj);
      return responseObj;
    })();

    broadcastEvent('NEW_ORDER', result);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

function deductInventoryForOrderInternal(orderId: string, orderCode: string, userId: string, now: string): void {
  const orderRow = db
    .prepare('SELECT inventory_deducted FROM orders WHERE id = ?')
    .get(orderId) as { inventory_deducted: number } | undefined;
  if (!orderRow || orderRow.inventory_deducted === 1) return;

  const items = db
    .prepare('SELECT product_id, product_name_snapshot, quantity FROM order_items WHERE order_id = ?')
    .all(orderId) as Array<{ product_id: string; product_name_snapshot: string; quantity: number }>;

  const recipeStmt = db.prepare('SELECT id FROM recipes WHERE product_id = ?');
  const recipeItemsStmt = db.prepare('SELECT ingredient_id, quantity FROM recipe_items WHERE recipe_id = ?');
  const ingStmt = db.prepare('SELECT id, current_stock, version FROM ingredients WHERE id = ?');
  const updateIngStmt = db.prepare('UPDATE ingredients SET current_stock = ?, version = ?, updated_at = ? WHERE id = ?');
  const insertMovStmt = db.prepare(
    `INSERT INTO inventory_movements (id, ingredient_id, movement_type, quantity_delta, stock_after, order_id, user_id, reason, created_at, updated_at)
     VALUES (?, ?, 'CONSUMO_VENTA', ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const item of items) {
    const recipe = recipeStmt.get(item.product_id) as { id: string } | undefined;
    if (!recipe) continue;

    const rItems = recipeItemsStmt.all(recipe.id) as Array<{ ingredient_id: string; quantity: number }>;
    for (const ri of rItems) {
      const consumeQty = Number((ri.quantity * item.quantity).toFixed(4));
      const ing = ingStmt.get(ri.ingredient_id) as { id: string; current_stock: number; version: number } | undefined;
      if (!ing) continue;

      const newStock = Number((ing.current_stock - consumeQty).toFixed(4));
      updateIngStmt.run(newStock, ing.version + 1, now, ing.id);
      insertMovStmt.run(
        crypto.randomUUID(),
        ing.id,
        -consumeQty,
        newStock,
        orderId,
        userId,
        `Preparación ${orderCode} - ${item.product_name_snapshot} x${item.quantity}`,
        now,
        now
      );
    }
  }

  db.prepare('UPDATE orders SET inventory_deducted = 1, updated_at = ? WHERE id = ?').run(now, orderId);
}

// 4. Actualizar estado en cocina y designar mozo + destino de entrega (Cocinero / Admin)
app.patch('/api/orders/:id/delivery-waiter', requirePermission('ORDERS_STATUS_UPDATE'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;
  const { deliveryWaiterId, deliveryDestination } = req.body as {
    deliveryWaiterId?: string | null;
    deliveryDestination?: string | null;
  };

  const order = db
    .prepare('SELECT id, order_code, delivery_destination, version FROM orders WHERE id = ?')
    .get(id) as
    | { id: string; order_code: string; delivery_destination: string | null; version: number }
    | undefined;
  if (!order) {
    res.status(404).json({ error: 'Comanda no encontrada.' });
    return;
  }

  let waiterName: string | null = null;
  if (deliveryWaiterId) {
    const waiter = db.prepare('SELECT id, full_name, is_active FROM users WHERE id = ?').get(deliveryWaiterId) as
      | { id: string; full_name: string; is_active: number }
      | undefined;
    if (!waiter || waiter.is_active !== 1) {
      res.status(400).json({ error: 'El mozo seleccionado no está activo.' });
      return;
    }
    waiterName = waiter.full_name;
  }

  const nextDest =
    deliveryDestination !== undefined ? deliveryDestination?.trim() || null : order.delivery_destination;
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE orders SET delivery_waiter_id = ?, delivery_destination = ?, version = ?, updated_at = ? WHERE id = ?'
  ).run(deliveryWaiterId || null, nextDest, order.version + 1, now, id);
  writeAuditLog(actor.id, 'DESIGNAR_MOZO_ENTREGA', 'orders', id, {
    orderCode: order.order_code,
    deliveryWaiterId: deliveryWaiterId || null,
    deliveryWaiterName: waiterName,
    deliveryDestination: nextDest,
  });

  broadcastEvent('ORDER_STATUS_CHANGED', {
    orderId: id,
    deliveryWaiterId: deliveryWaiterId || null,
    deliveryDestination: nextDest,
  });
  res.json({
    status: 'UPDATED',
    orderId: id,
    deliveryWaiterId: deliveryWaiterId || null,
    deliveryDestination: nextDest,
  });
});

app.patch('/api/orders/:id/status', requirePermission('ORDERS_STATUS_UPDATE'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;
  const { status, deliveryWaiterId, deliveryDestination } = req.body as {
    status: 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO';
    deliveryWaiterId?: string | null;
    deliveryDestination?: string | null;
  };

  const order = db
    .prepare(
      'SELECT id, order_code, table_id, kitchen_status, delivery_waiter_id, delivery_destination, version FROM orders WHERE id = ?'
    )
    .get(id) as
    | {
        id: string;
        order_code: string;
        table_id: string | null;
        kitchen_status: string;
        delivery_waiter_id: string | null;
        delivery_destination: string | null;
        version: number;
      }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'Comanda no encontrada.' });
    return;
  }

  let nextDeliveryWaiterId = order.delivery_waiter_id;
  if (deliveryWaiterId !== undefined) {
    if (deliveryWaiterId) {
      const waiter = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(deliveryWaiterId) as
        | { id: string; is_active: number }
        | undefined;
      if (!waiter || waiter.is_active !== 1) {
        res.status(400).json({ error: 'El mozo designado para entrega no está activo.' });
        return;
      }
      nextDeliveryWaiterId = waiter.id;
    } else {
      nextDeliveryWaiterId = null;
    }
  }

  let nextDestination =
    deliveryDestination !== undefined ? deliveryDestination?.trim() || null : order.delivery_destination;
  if (status === 'ENTREGADO' && !nextDestination) {
    if (order.table_id) {
      const tbl = db.prepare('SELECT label FROM dining_tables WHERE id = ?').get(order.table_id) as
        | { label: string }
        | undefined;
      nextDestination = tbl?.label ?? null;
    }
    if (!nextDestination) {
      res.status(400).json({ error: 'Indica a dónde debe enviar el mozo este pedido antes de entregarlo.' });
      return;
    }
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    if (status === 'EN_PREPARACION') {
      deductInventoryForOrderInternal(order.id, order.order_code, actor.id, now);
      db.prepare(
        'UPDATE orders SET kitchen_status = ?, delivery_waiter_id = ?, delivery_destination = ?, prep_started_at = COALESCE(prep_started_at, ?), version = ?, updated_at = ? WHERE id = ?'
      ).run('EN_PREPARACION', nextDeliveryWaiterId, nextDestination, now, order.version + 1, now, id);
    } else if (status === 'LISTO') {
      deductInventoryForOrderInternal(order.id, order.order_code, actor.id, now);
      db.prepare(
        'UPDATE orders SET kitchen_status = ?, delivery_waiter_id = ?, delivery_destination = ?, ready_at = COALESCE(ready_at, ?), version = ?, updated_at = ? WHERE id = ?'
      ).run('LISTO', nextDeliveryWaiterId, nextDestination, now, order.version + 1, now, id);
    } else if (status === 'ENTREGADO') {
      db.prepare(
        'UPDATE orders SET kitchen_status = ?, delivery_waiter_id = ?, delivery_destination = ?, delivered_at = COALESCE(delivered_at, ?), version = ?, updated_at = ? WHERE id = ?'
      ).run('ENTREGADO', nextDeliveryWaiterId, nextDestination, now, order.version + 1, now, id);
      writeAuditLog(actor.id, 'COCINA_ENTREGA_PEDIDO', 'orders', id, {
        orderCode: order.order_code,
        deliveryWaiterId: nextDeliveryWaiterId,
        deliveryDestination: nextDestination,
      });
    }
  })();

  broadcastEvent('ORDER_STATUS_CHANGED', {
    orderId: id,
    status,
    deliveryWaiterId: nextDeliveryWaiterId,
    deliveryDestination: nextDestination,
  });
  res.json({
    status: 'UPDATED',
    orderId: id,
    kitchenStatus: status,
    deliveryWaiterId: nextDeliveryWaiterId,
    deliveryDestination: nextDestination,
  });
});

app.patch('/api/orders/:id/confirm-delivery', requirePermission('TABLES_VIEW'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;
  const order = db
    .prepare('SELECT id, order_code, delivery_destination, version FROM orders WHERE id = ?')
    .get(id) as
    | { id: string; order_code: string; delivery_destination: string | null; version: number }
    | undefined;
  if (!order) {
    res.status(404).json({ error: 'Comanda no encontrada.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE orders SET waiter_confirmed_at = ?, version = ?, updated_at = ? WHERE id = ?').run(
    now,
    order.version + 1,
    now,
    id
  );
  writeAuditLog(actor.id, 'CONFIRMAR_ENTREGA_DESTINO', 'orders', id, {
    orderCode: order.order_code,
    deliveryDestination: order.delivery_destination,
  });
  broadcastEvent('ORDER_STATUS_CHANGED', { orderId: id, waiterConfirmedAt: now });
  res.json({ status: 'CONFIRMED', orderId: id, waiterConfirmedAt: now });
});

// 5. Anulación controlada de pedido (Admin o Cajero)
app.post('/api/orders/:id/cancel', requirePermission('PAYMENTS_REGISTER'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;
  const { reason, alreadyCooked } = req.body as { reason?: string; alreadyCooked?: boolean };
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: 'Debes indicar el motivo de la anulación.' });
    return;
  }

  const order = db
    .prepare('SELECT id, order_code, account_id, table_id, kitchen_status, inventory_deducted, version FROM orders WHERE id = ?')
    .get(id) as
    | {
        id: string;
        order_code: string;
        account_id: string;
        table_id: string | null;
        kitchen_status: string;
        inventory_deducted: number;
        version: number;
      }
    | undefined;

  if (!order) {
    res.status(404).json({ error: 'Pedido no encontrado.' });
    return;
  }
  if (order.kitchen_status === 'ANULADO') {
    res.status(400).json({ error: 'El pedido ya fue anulado.' });
    return;
  }

  const now = new Date().toISOString();
  const isCooked = Boolean(alreadyCooked) || order.kitchen_status === 'EN_PREPARACION' || order.kitchen_status === 'LISTO' || order.kitchen_status === 'ENTREGADO';

  db.transaction(() => {
    if (order.inventory_deducted === 1) {
      const movs = db
        .prepare("SELECT ingredient_id, quantity_delta FROM inventory_movements WHERE order_id = ? AND movement_type = 'CONSUMO_VENTA'")
        .all(order.id) as Array<{ ingredient_id: string; quantity_delta: number }>;

      for (const m of movs) {
        const qty = Math.abs(m.quantity_delta);
        const ing = db
          .prepare('SELECT id, current_stock, average_unit_cost, version FROM ingredients WHERE id = ?')
          .get(m.ingredient_id) as { id: string; current_stock: number; average_unit_cost: number; version: number } | undefined;
        if (!ing) continue;

        if (isCooked) {
          db.prepare(
            `INSERT INTO waste_records (id, ingredient_id, order_id, quantity, estimated_loss, reason, registered_by_user_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            crypto.randomUUID(),
            ing.id,
            order.id,
            qty,
            Number((qty * ing.average_unit_cost).toFixed(2)),
            `Anulación post-preparación (${order.order_code}): ${reason.trim()}`,
            actor.id,
            now,
            now
          );
        } else {
          const restored = Number((ing.current_stock + qty).toFixed(4));
          db.prepare('UPDATE ingredients SET current_stock = ?, version = ?, updated_at = ? WHERE id = ?').run(
            restored,
            ing.version + 1,
            now,
            ing.id
          );
          db.prepare(
            `INSERT INTO inventory_movements (id, ingredient_id, movement_type, quantity_delta, stock_after, order_id, user_id, reason, created_at, updated_at)
             VALUES (?, ?, 'REVERSION_ANULACION', ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            crypto.randomUUID(),
            ing.id,
            qty,
            restored,
            order.id,
            actor.id,
            `Reversión por anulación (${order.order_code}): ${reason.trim()}`,
            now,
            now
          );
        }
      }
    }

    const orderItems = db
      .prepare('SELECT unit_price_snapshot, quantity, account_guest_id FROM order_items WHERE order_id = ?')
      .all(order.id) as Array<{ unit_price_snapshot: number; quantity: number; account_guest_id: string | null }>;
    const orderTotal = orderItems.reduce((s, it) => s + it.unit_price_snapshot * it.quantity, 0);

    for (const it of orderItems) {
      if (it.account_guest_id) {
        db.prepare('UPDATE account_guests SET total_assigned = MAX(0, total_assigned - ?), updated_at = ? WHERE id = ?').run(
          Number((it.unit_price_snapshot * it.quantity).toFixed(2)),
          now,
          it.account_guest_id
        );
      }
    }

    db.prepare(
      "UPDATE orders SET kitchen_status = 'ANULADO', cancellation_reason = ?, version = ?, updated_at = ? WHERE id = ?"
    ).run(reason.trim(), order.version + 1, now, order.id);

    const acc = db
      .prepare('SELECT total_amount, paid_amount FROM accounts WHERE id = ?')
      .get(order.account_id) as { total_amount: number; paid_amount: number };
    const newAccTotal = Math.max(0, Number((acc.total_amount - orderTotal).toFixed(2)));
    const remainingOrders = db
      .prepare("SELECT COUNT(*) as cnt FROM orders WHERE account_id = ? AND kitchen_status != 'ANULADO'")
      .get(order.account_id) as { cnt: number };

    if (remainingOrders.cnt === 0 && acc.paid_amount === 0) {
      db.prepare("UPDATE accounts SET total_amount = 0, status = 'ANULADA', closed_at = ?, updated_at = ? WHERE id = ?").run(
        now,
        now,
        order.account_id
      );
      if (order.table_id) {
        db.prepare("UPDATE dining_tables SET status = 'LIBRE', active_account_id = NULL, updated_at = ? WHERE id = ?").run(
          now,
          order.table_id
        );
      }
    } else {
      db.prepare('UPDATE accounts SET total_amount = ?, updated_at = ? WHERE id = ?').run(newAccTotal, now, order.account_id);
    }

    writeAuditLog(actor.id, 'ANULAR_PEDIDO', 'orders', order.id, {
      orderCode: order.order_code,
      reason: reason.trim(),
      alreadyCooked: isCooked,
    });
  })();

  broadcastEvent('ORDER_CANCELLED', { orderId: id });
  res.json({ status: 'CANCELLED' });
});

// 6. Mesas: crear configurable, cambiar estado (Limpieza -> Libre), trasladar mesa
app.post('/api/tables', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { number, label } = req.body as { number: number; label?: string };
  if (!number || number <= 0) {
    res.status(400).json({ error: 'Número de mesa inválido.' });
    return;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const tableLabel = (label ?? '').trim() || `Mesa ${String(number).padStart(2, '0')}`;
  try {
    db.prepare("INSERT INTO dining_tables (id, number, label, status, updated_at) VALUES (?, ?, ?, 'LIBRE', ?)").run(
      id,
      number,
      tableLabel,
      now
    );
    writeAuditLog(actor.id, 'CREAR_MESA', 'dining_tables', id, { number, tableLabel });
    broadcastEvent('TABLES_UPDATED', { id });
    res.status(201).json({ id, number, label: tableLabel });
  } catch {
    res.status(400).json({ error: `Ya existe una mesa con el número ${number}.` });
  }
});

app.patch('/api/tables/:id/status', requirePermission('TABLES_VIEW'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;
  const { status, forceRelease } = req.body as {
    status: 'LIBRE' | 'OCUPADA' | 'PENDIENTE_PAGO' | 'EN_LIMPIEZA';
    forceRelease?: boolean;
  };
  const tbl = db.prepare('SELECT id, label, active_account_id FROM dining_tables WHERE id = ?').get(id) as
    | { id: string; label: string; active_account_id: string | null }
    | undefined;
  if (!tbl) {
    res.status(404).json({ error: 'Mesa no encontrada.' });
    return;
  }

  const now = new Date().toISOString();

  if (status === 'LIBRE') {
    if (tbl.active_account_id) {
      const acc = db
        .prepare('SELECT id, total_amount, paid_amount, status, version FROM accounts WHERE id = ?')
        .get(tbl.active_account_id) as
        | { id: string; total_amount: number; paid_amount: number; status: string; version: number }
        | undefined;
      const pending = acc ? Number((acc.total_amount - acc.paid_amount).toFixed(2)) : 0;

      if (acc && acc.status !== 'CERRADA' && pending > 0.01 && !forceRelease) {
        res.status(400).json({
          error: `La mesa tiene S/ ${pending.toFixed(2)} pendiente de pago. Confirma liberar pasando la cuenta a Caja.`,
        });
        return;
      }

      db.transaction(() => {
        if (acc && acc.status !== 'CERRADA' && pending > 0.01) {
          db.prepare(
            "UPDATE accounts SET table_id = NULL, status = 'PENDIENTE_PAGO', version = ?, updated_at = ? WHERE id = ?"
          ).run(acc.version + 1, now, acc.id);
          db.prepare(
            'UPDATE orders SET delivery_destination = COALESCE(delivery_destination, ?), table_id = NULL, updated_at = ? WHERE account_id = ?'
          ).run(tbl.label, now, acc.id);
        } else if (acc && acc.status !== 'CERRADA') {
          db.prepare(
            "UPDATE accounts SET status = 'CERRADA', closed_at = COALESCE(closed_at, ?), version = ?, updated_at = ? WHERE id = ?"
          ).run(now, acc.version + 1, now, acc.id);
        }
        db.prepare("UPDATE dining_tables SET status = 'LIBRE', active_account_id = NULL, updated_at = ? WHERE id = ?").run(
          now,
          id
        );
        writeAuditLog(actor.id, 'LIBERAR_MESA', 'dining_tables', id, {
          tableLabel: tbl.label,
          accountId: tbl.active_account_id,
          pendingMovedToCashier: pending > 0.01 ? pending : 0,
        });
      })();
    } else {
      db.prepare("UPDATE dining_tables SET status = 'LIBRE', active_account_id = NULL, updated_at = ? WHERE id = ?").run(
        now,
        id
      );
      writeAuditLog(actor.id, 'LIBERAR_MESA', 'dining_tables', id, { tableLabel: tbl.label });
    }
    broadcastEvent('TABLES_UPDATED', { id, status: 'LIBRE' });
    res.json({ status: 'UPDATED' });
    return;
  }

  db.prepare('UPDATE dining_tables SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
  broadcastEvent('TABLES_UPDATED', { id, status });
  res.json({ status: 'UPDATED' });
});

app.post('/api/tables/:fromId/transfer', requirePermission('TABLES_VIEW'), (req, res) => {
  const actor = getActorFromReq(req);
  const { fromId } = req.params;
  const { toTableId } = req.body as { toTableId: string };
  const now = new Date().toISOString();

  try {
    db.transaction(() => {
      const fromTable = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(fromId) as
        | { id: string; label: string; active_account_id: string | null }
        | undefined;
      const toTable = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(toTableId) as
        | { id: string; label: string; status: string; active_account_id: string | null }
        | undefined;

      if (!fromTable || !toTable) throw new Error('Mesa origen o destino no encontrada.');
      if (!fromTable.active_account_id) throw new Error('La mesa origen no tiene cuenta activa.');
      if (toTable.status !== 'LIBRE' || toTable.active_account_id) throw new Error('La mesa destino debe estar LIBRE.');

      const accId = fromTable.active_account_id;
      db.prepare('UPDATE accounts SET table_id = ?, updated_at = ? WHERE id = ?').run(toTableId, now, accId);
      db.prepare('UPDATE orders SET table_id = ?, updated_at = ? WHERE account_id = ?').run(toTableId, now, accId);
      db.prepare("UPDATE dining_tables SET status = 'LIBRE', active_account_id = NULL, updated_at = ? WHERE id = ?").run(
        now,
        fromId
      );
      db.prepare("UPDATE dining_tables SET status = 'OCUPADA', active_account_id = ?, updated_at = ? WHERE id = ?").run(
        accId,
        now,
        toTableId
      );
      writeAuditLog(actor.id, 'TRASLADO_MESA', 'dining_tables', accId, { from: fromTable.label, to: toTable.label });
    })();
  broadcastEvent('TABLES_UPDATED', { fromId, toTableId });
    res.json({ status: 'TRANSFERRED' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

function computeEndTime(startTime: string, durationHours: number): string {
  const [hhStr, mmStr] = startTime.split(':');
  const startMinutes = (Number.parseInt(hhStr, 10) || 0) * 60 + (Number.parseInt(mmStr, 10) || 0);
  const totalMinutes = Math.min(23 * 60 + 59, startMinutes + Math.round(durationHours * 60));
  const endH = Math.floor(totalMinutes / 60);
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

app.post('/api/reservations', requirePermission('TABLES_VIEW'), (req, res) => {
  const actor = getActorFromReq(req);
  const {
    tableId,
    customerName,
    customerPhone,
    serviceMode,
    reservationDate,
    startTime,
    durationHours,
    notes,
    preOrderItems,
  } = req.body as {
    tableId?: string | null;
    customerName: string;
    customerPhone?: string | null;
    serviceMode: 'EN_MESA' | 'PARA_LLEVAR';
    reservationDate: string;
    startTime: string;
    durationHours: number;
    notes?: string;
    preOrderItems?: Array<{ productId: string; quantity: number; notes?: string }>;
  };

  if (!customerName?.trim() || !reservationDate || !startTime || !durationHours || durationHours <= 0) {
    res.status(400).json({ error: 'Cliente, fecha, hora de inicio y duración en horas son obligatorios.' });
    return;
  }
  if (serviceMode === 'EN_MESA' && !tableId) {
    res.status(400).json({ error: 'Selecciona una mesa para reservas en salón.' });
    return;
  }

  const endTime = computeEndTime(startTime, durationHours);
  if (endTime <= startTime) {
    res.status(400).json({ error: 'La hora de fin debe ser posterior a la hora de inicio dentro del mismo día.' });
    return;
  }

  if (tableId) {
    const tableRow = db.prepare('SELECT id, label FROM dining_tables WHERE id = ?').get(tableId) as
      | { id: string; label: string }
      | undefined;
    if (!tableRow) {
      res.status(404).json({ error: 'La mesa seleccionada no existe.' });
      return;
    }
    const overlap = db
      .prepare(
        `SELECT customer_name, start_time, end_time FROM table_reservations
         WHERE table_id = ? AND reservation_date = ? AND status IN ('PENDIENTE', 'EN_PREPARACION')
           AND start_time < ? AND end_time > ?`
      )
      .get(tableId, reservationDate, endTime, startTime) as
      | { customer_name: string; start_time: string; end_time: string }
      | undefined;
    if (overlap) {
      res.status(400).json({
        error: `${tableRow.label} ya está reservada por ${overlap.customer_name} de ${overlap.start_time} a ${overlap.end_time}.`,
      });
      return;
    }
  }

  const resolvedPreItems: Array<{ productId: string; productName: string; quantity: number; notes?: string }> = [];
  if (Array.isArray(preOrderItems)) {
    const prodStmt = db.prepare('SELECT id, name FROM products WHERE id = ?');
    for (const item of preOrderItems) {
      if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) continue;
      const prod = prodStmt.get(item.productId) as { id: string; name: string } | undefined;
      if (prod) {
        resolvedPreItems.push({
          productId: prod.id,
          productName: prod.name,
          quantity: item.quantity,
          notes: item.notes?.trim() || undefined,
        });
      }
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO table_reservations (id, table_id, customer_name, customer_phone, service_mode, reservation_date, start_time, end_time, duration_hours, status, notes, pre_order_items_json, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?)`
  ).run(
    id,
    tableId || null,
    customerName.trim(),
    customerPhone?.trim() || null,
    serviceMode,
    reservationDate,
    startTime,
    endTime,
    Number(durationHours),
    notes?.trim() || '',
    resolvedPreItems.length > 0 ? JSON.stringify(resolvedPreItems) : null,
    actor.id,
    now,
    now
  );

  writeAuditLog(actor.id, 'CREAR_RESERVA', 'table_reservations', id, {
    customerName: customerName.trim(),
    tableId: tableId || null,
    serviceMode,
    reservationDate,
    startTime,
    endTime,
    preOrderCount: resolvedPreItems.length,
  });

  broadcastEvent('RESERVATIONS_UPDATED', { id });
  res.status(201).json({ id, endTime });
});

app.patch('/api/reservations/:id/status', requirePermission('TABLES_VIEW'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;
  const { status, sendToKitchen } = req.body as {
    status: 'PENDIENTE' | 'EN_PREPARACION' | 'COMPLETADA' | 'CANCELADA';
    sendToKitchen?: boolean;
  };

  const resRow = db.prepare('SELECT * FROM table_reservations WHERE id = ?').get(id) as
    | {
        id: string;
        table_id: string | null;
        customer_name: string;
        customer_phone: string | null;
        service_mode: 'EN_MESA' | 'PARA_LLEVAR';
        reservation_date: string;
        start_time: string;
        end_time: string;
        status: string;
        pre_order_items_json: string | null;
        linked_order_id: string | null;
      }
    | undefined;

  if (!resRow) {
    res.status(404).json({ error: 'Reserva no encontrada.' });
    return;
  }

  const now = new Date().toISOString();
  let createdOrderId: string | null = null;

  try {
    db.transaction(() => {
      if (sendToKitchen && !resRow.linked_order_id) {
        const preItems = resRow.pre_order_items_json
          ? (JSON.parse(resRow.pre_order_items_json) as Array<{
              productId: string;
              quantity: number;
              notes?: string;
            }>)
          : [];

        const isTakeaway = resRow.service_mode === 'PARA_LLEVAR' || !resRow.table_id;
        const tableRow = resRow.table_id
          ? (db.prepare('SELECT id, label, active_account_id FROM dining_tables WHERE id = ?').get(resRow.table_id) as
              | { id: string; label: string; active_account_id: string | null }
              | undefined)
          : undefined;

        if (preItems.length > 0) {
          let addedTotal = 0;
          const resolved: Array<{
            id: string;
            productId: string;
            name: string;
            price: number;
            quantity: number;
            notes: string;
            requiresKitchen: boolean;
          }> = [];
          const prodStmt = db.prepare('SELECT id, name, price, is_available, requires_kitchen FROM products WHERE id = ?');
          for (const it of preItems) {
            const prod = prodStmt.get(it.productId) as
              | { id: string; name: string; price: number; is_available: number; requires_kitchen: number }
              | undefined;
            if (!prod) continue;
            addedTotal += prod.price * it.quantity;
            resolved.push({
              id: crypto.randomUUID(),
              productId: prod.id,
              name: prod.name,
              price: prod.price,
              quantity: it.quantity,
              notes: it.notes ?? `Reserva ${resRow.start_time}`,
              requiresKitchen: prod.requires_kitchen === 1,
            });
          }

          if (resolved.length > 0) {
            let accountId = !isTakeaway && tableRow?.active_account_id ? tableRow.active_account_id : null;
            if (accountId) {
              const acc = db
                .prepare('SELECT id, total_amount, version, status FROM accounts WHERE id = ?')
                .get(accountId) as { id: string; total_amount: number; version: number; status: string } | undefined;
              if (!acc || acc.status === 'CERRADA' || acc.status === 'ANULADA') {
                accountId = null;
              } else {
                db.prepare('UPDATE accounts SET total_amount = ?, version = ?, updated_at = ? WHERE id = ?').run(
                  Number((acc.total_amount + addedTotal).toFixed(2)),
                  acc.version + 1,
                  now,
                  accountId
                );
              }
            }

            if (!accountId) {
              accountId = crypto.randomUUID();
              db.prepare(
                `INSERT INTO accounts (id, table_id, is_takeaway, main_customer_name, waiter_id, status, total_amount, paid_amount, opened_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'ABIERTA', ?, 0, ?, ?)`
              ).run(
                accountId,
                isTakeaway ? null : resRow.table_id,
                isTakeaway ? 1 : 0,
                resRow.customer_name,
                actor.id,
                Number(addedTotal.toFixed(2)),
                now,
                now
              );
            }

            if (!isTakeaway && resRow.table_id) {
              db.prepare(
                "UPDATE dining_tables SET status = 'OCUPADA', active_account_id = ?, updated_at = ? WHERE id = ?"
              ).run(accountId, now, resRow.table_id);
            }

            const countRow = db.prepare('SELECT COUNT(*) as cnt FROM orders').get() as { cnt: number };
            const orderCode = `RES-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${String(
              countRow.cnt + 1
            ).padStart(4, '0')}`;
            createdOrderId = crypto.randomUUID();
            const hasKitchen = resolved.some((r) => r.requiresKitchen);
            const dest = isTakeaway
              ? `PARA LLEVAR (Reserva ${resRow.start_time})`
              : tableRow?.label ?? 'Mesa Reservada';

            db.prepare(
              `INSERT INTO orders (id, order_code, account_id, table_id, waiter_id, delivery_destination, customer_name, kitchen_status, inventory_deducted, created_at, delivered_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
            ).run(
              createdOrderId,
              orderCode,
              accountId,
              isTakeaway ? null : resRow.table_id,
              actor.id,
              dest,
              resRow.customer_name,
              hasKitchen ? 'NUEVO' : 'ENTREGADO',
              now,
              hasKitchen ? null : now,
              now
            );

            const insertItemStmt = db.prepare(
              `INSERT INTO order_items (id, order_id, product_id, account_guest_id, product_name_snapshot, unit_price_snapshot, quantity, notes, updated_at)
               VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`
            );
            for (const item of resolved) {
              insertItemStmt.run(
                item.id,
                createdOrderId,
                item.productId,
                item.name,
                item.price,
                item.quantity,
                item.notes,
                now
              );
            }

            if (!hasKitchen) {
              deductInventoryForOrderInternal(createdOrderId, orderCode, actor.id, now);
            }
          }
        } else if (!isTakeaway && resRow.table_id && tableRow && !tableRow.active_account_id) {
          const accountId = crypto.randomUUID();
          db.prepare(
            `INSERT INTO accounts (id, table_id, is_takeaway, main_customer_name, waiter_id, status, total_amount, paid_amount, opened_at, updated_at)
             VALUES (?, ?, 0, ?, ?, 'ABIERTA', 0, 0, ?, ?)`
          ).run(accountId, resRow.table_id, resRow.customer_name, actor.id, now, now);
          db.prepare(
            "UPDATE dining_tables SET status = 'OCUPADA', active_account_id = ?, updated_at = ? WHERE id = ?"
          ).run(accountId, now, resRow.table_id);
        }
      }

      db.prepare(
        'UPDATE table_reservations SET status = ?, linked_order_id = COALESCE(linked_order_id, ?), updated_at = ? WHERE id = ?'
      ).run(status, createdOrderId, now, id);

      writeAuditLog(actor.id, 'ACTUALIZAR_RESERVA', 'table_reservations', id, {
        status,
        sendToKitchen: Boolean(sendToKitchen),
        createdOrderId,
      });
    })();

    if (createdOrderId) {
      broadcastEvent('NEW_ORDER', { orderId: createdOrderId });
    }
    broadcastEvent('RESERVATIONS_UPDATED', { id, status });
    res.json({ status: 'UPDATED', createdOrderId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 7. División de cuenta por comensales
app.post('/api/accounts/:accountId/split', requirePermission('ACCOUNTS_SPLIT'), (req, res) => {
  const { accountId } = req.params;
  const { guests } = req.body as { guests: Array<{ guestName: string; amount: number }> };
  const acc = db.prepare('SELECT total_amount FROM accounts WHERE id = ?').get(accountId) as
    | { total_amount: number }
    | undefined;
  if (!acc) {
    res.status(404).json({ error: 'Cuenta no encontrada.' });
    return;
  }

  const sumGuests = guests.reduce((s, g) => s + g.amount, 0);
  if (Math.abs(sumGuests - acc.total_amount) > 0.05) {
    res.status(400).json({
      error: `La suma de divisiones (S/ ${sumGuests.toFixed(2)}) debe coincidir con el total de la cuenta (S/ ${acc.total_amount.toFixed(2)}).`,
    });
    return;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('UPDATE order_items SET account_guest_id = NULL WHERE order_id IN (SELECT id FROM orders WHERE account_id = ?)').run(
      accountId
    );
    db.prepare('DELETE FROM account_guests WHERE account_id = ? AND paid_amount = 0').run(accountId);
    const insertGuest = db.prepare(
      'INSERT INTO account_guests (id, account_id, guest_name, total_assigned, paid_amount, is_settled, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?)'
    );
    for (const g of guests) {
      if (g.amount > 0) {
        insertGuest.run(crypto.randomUUID(), accountId, g.guestName.trim() || 'Cliente', Number(g.amount.toFixed(2)), now);
      }
    }
  })();

  broadcastEvent('ACCOUNT_SPLIT', { accountId });
  res.json({ status: 'SPLIT_SAVED' });
});

// 8. Caja: Apertura, Cierre, Pagos y Movimientos (Ingresos / Gastos)
app.post('/api/cash-register/open', requirePermission('CASH_REGISTER_MANAGE'), (req, res) => {
  const actor = getActorFromReq(req);
  const { openingBalance } = req.body as { openingBalance: number };
  if (openingBalance < 0 || Number.isNaN(openingBalance)) {
    res.status(400).json({ error: 'Saldo inicial inválido.' });
    return;
  }
  const openReg = db.prepare("SELECT id FROM cash_registers WHERE status = 'ABIERTA'").get();
  if (openReg) {
    res.status(400).json({ error: 'Ya existe una caja abierta.' });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO cash_registers (id, cashier_id, opening_balance, expected_closing_balance, status, opened_at, updated_at)
     VALUES (?, ?, ?, ?, 'ABIERTA', ?, ?)`
  ).run(id, actor.id, Number(openingBalance.toFixed(2)), Number(openingBalance.toFixed(2)), now, now);

  writeAuditLog(actor.id, 'APERTURA_CAJA', 'cash_registers', id, { openingBalance });
  broadcastEvent('CASH_REGISTER_UPDATED', { id });
  res.status(201).json({ id });
});

app.post('/api/cash-register/:id/close', requirePermission('CASH_REGISTER_MANAGE'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;
  const { declaredBalance } = req.body as { declaredBalance: number };
  const reg = db.prepare('SELECT * FROM cash_registers WHERE id = ?').get(id) as
    | { id: string; opening_balance: number; status: string }
    | undefined;
  if (!reg || reg.status !== 'ABIERTA') {
    res.status(400).json({ error: 'Caja no encontrada o ya cerrada.' });
    return;
  }

  const movs = db
    .prepare('SELECT movement_type, method, amount FROM payments WHERE cash_register_id = ?')
    .all(id) as Array<{ movement_type: string; method: string; amount: number }>;

  let cashDelta = 0;
  for (const m of movs) {
    if (m.movement_type === 'GASTO_AUTORIZADO') {
      cashDelta -= m.amount;
    } else if (m.method === 'EFECTIVO' || m.method === 'COMBINADO') {
      cashDelta += m.amount;
    }
  }
  const expected = Number((reg.opening_balance + cashDelta).toFixed(2));
  const diff = Number((declaredBalance - expected).toFixed(2));
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE cash_registers
     SET expected_closing_balance = ?, declared_closing_balance = ?, difference = ?, status = 'CERRADA', closed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(expected, Number(declaredBalance.toFixed(2)), diff, now, now, id);

  writeAuditLog(actor.id, 'CIERRE_CAJA', 'cash_registers', id, { expected, declaredBalance, difference: diff });
  broadcastEvent('CASH_REGISTER_UPDATED', { id });
  res.json({ expected, declaredBalance, difference: diff });
});

app.post('/api/cash-movements', requirePermission('CASH_REGISTER_MANAGE'), (req, res) => {
  const actor = getActorFromReq(req);
  const { cashRegisterId, movementType, method, amount, referenceNote } = req.body as {
    cashRegisterId: string;
    movementType: 'INGRESO_EXTRA' | 'GASTO_AUTORIZADO';
    method: 'EFECTIVO' | 'YAPE' | 'PLIN' | 'TRANSFERENCIA';
    amount: number;
    referenceNote: string;
  };
  if (amount <= 0 || !referenceNote?.trim()) {
    res.status(400).json({ error: 'Monto y descripción son obligatorios.' });
    return;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO payments (id, cash_register_id, movement_type, method, amount, received_amount, change_amount, reference_note, registered_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`
  ).run(id, cashRegisterId, movementType, method, Number(amount.toFixed(2)), Number(amount.toFixed(2)), referenceNote.trim(), actor.id, now, now);

  writeAuditLog(actor.id, movementType, 'payments', id, { amount, method, referenceNote });
  broadcastEvent('PAYMENT_REGISTERED', { id });
  res.status(201).json({ id });
});

app.post('/api/payments', requirePermission('PAYMENTS_REGISTER'), (req, res) => {
  const actor = getActorFromReq(req);
  const idempotencyKey = req.header('idempotency-key');
  const idem = checkIdempotency(idempotencyKey);
  if (idem.exists) {
    res.status(200).json(idem.response);
    return;
  }

  const {
    cashRegisterId,
    accountId,
    accountGuestId,
    method,
    amountToApply,
    receivedAmount,
    referenceNote,
    validationCode,
    proofImageUrl,
  } = req.body as {
    cashRegisterId: string;
    accountId: string;
    accountGuestId?: string | null;
    method: 'EFECTIVO' | 'YAPE' | 'PLIN' | 'TRANSFERENCIA' | 'COMBINADO';
    amountToApply: number;
    receivedAmount?: number;
    referenceNote?: string | null;
    validationCode?: string | null;
    proofImageUrl?: string | null;
  };

  try {
    const result = db.transaction(() => {
      const reg = db.prepare('SELECT status FROM cash_registers WHERE id = ?').get(cashRegisterId) as
        | { status: string }
        | undefined;
      if (!reg || reg.status !== 'ABIERTA') throw new Error('Debe abrir una caja antes de registrar cobros.');

      const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
        | {
            id: string;
            table_id: string | null;
            main_customer_name: string;
            waiter_id: string;
            total_amount: number;
            paid_amount: number;
            version: number;
            status: string;
          }
        | undefined;
      if (!acc) throw new Error('Cuenta no encontrada.');
      if (acc.status === 'CERRADA') throw new Error('Esta cuenta ya está cerrada.');

      const pendingBefore = Number((acc.total_amount - acc.paid_amount).toFixed(2));
      if (amountToApply <= 0 || amountToApply > pendingBefore + 0.01) {
        throw new Error(`El monto (S/ ${amountToApply.toFixed(2)}) excede el saldo pendiente (S/ ${pendingBefore.toFixed(2)}).`);
      }

      const cleanCode = (validationCode ?? '').trim();
      const cleanProof =
        typeof proofImageUrl === 'string' && proofImageUrl.startsWith('data:image/') ? proofImageUrl : null;

      if (method !== 'EFECTIVO' && cleanCode.length < 3 && !cleanProof) {
        throw new Error(
          `Para pagos con ${method}, toma una foto del comprobante o ingresa el código de operación.`
        );
      }

      const rawReceived =
        typeof receivedAmount === 'number' && Number.isFinite(receivedAmount) ? receivedAmount : amountToApply;
      const effectiveReceived = method === 'EFECTIVO' || method === 'COMBINADO' ? rawReceived : amountToApply;
      if ((method === 'EFECTIVO' || method === 'COMBINADO') && effectiveReceived < amountToApply - 0.001) {
        throw new Error('El importe recibido es menor al monto a cobrar.');
      }
      const changeAmount =
        method === 'EFECTIVO' || method === 'COMBINADO'
          ? Math.max(0, Number((effectiveReceived - amountToApply).toFixed(2)))
          : 0;

      const now = new Date().toISOString();
      const paymentId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO payments (id, cash_register_id, account_id, account_guest_id, movement_type, method, amount, received_amount, change_amount, reference_note, validation_code, proof_image_url, registered_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'INGRESO_VENTA', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        paymentId,
        cashRegisterId,
        accountId,
        accountGuestId ?? null,
        method,
        Number(amountToApply.toFixed(2)),
        Number(effectiveReceived.toFixed(2)),
        changeAmount,
        referenceNote?.trim() || null,
        cleanCode || null,
        cleanProof,
        actor.id,
        now,
        now
      );

      if (accountGuestId) {
        const guest = db.prepare('SELECT total_assigned, paid_amount FROM account_guests WHERE id = ?').get(accountGuestId) as
          | { total_assigned: number; paid_amount: number }
          | undefined;
        if (guest) {
          const newGuestPaid = Number((guest.paid_amount + amountToApply).toFixed(2));
          const settled = newGuestPaid >= guest.total_assigned - 0.01 ? 1 : 0;
          db.prepare('UPDATE account_guests SET paid_amount = ?, is_settled = ?, updated_at = ? WHERE id = ?').run(
            newGuestPaid,
            settled,
            now,
            accountGuestId
          );
        }
      }

      const newPaid = Number((acc.paid_amount + amountToApply).toFixed(2));
      const newPending = Math.max(0, Number((acc.total_amount - newPaid).toFixed(2)));
      const fullyPaid = newPending <= 0.01;

      db.prepare('UPDATE accounts SET paid_amount = ?, status = ?, closed_at = ?, version = ?, updated_at = ? WHERE id = ?').run(
        newPaid,
        fullyPaid ? 'CERRADA' : 'PENDIENTE_PAGO',
        fullyPaid ? now : null,
        acc.version + 1,
        now,
        accountId
      );

      if (acc.table_id) {
        if (fullyPaid) {
          db.prepare("UPDATE dining_tables SET status = 'LIBRE', active_account_id = NULL, updated_at = ? WHERE id = ?").run(
            now,
            acc.table_id
          );
        } else {
          db.prepare("UPDATE dining_tables SET status = 'PENDIENTE_PAGO', updated_at = ? WHERE id = ?").run(
            now,
            acc.table_id
          );
        }
      }

      // Generar comprobante interno
      const recCount = (db.prepare('SELECT COUNT(*) as cnt FROM internal_receipts').get() as { cnt: number }).cnt + 1;
      const receiptNumber = `INT-${String(recCount).padStart(6, '0')}`;

      const ordersForAcc = db
        .prepare("SELECT id, order_code FROM orders WHERE account_id = ? AND kitchen_status != 'ANULADO'")
        .all(accountId) as Array<{ id: string; order_code: string }>;
      const items: Array<{ name: string; qty: number; price: number }> = [];
      for (const o of ordersForAcc) {
        const oItems = db
          .prepare('SELECT product_name_snapshot, quantity, unit_price_snapshot FROM order_items WHERE order_id = ?')
          .all(o.id) as Array<{ product_name_snapshot: string; quantity: number; unit_price_snapshot: number }>;
        for (const it of oItems) {
          items.push({ name: it.product_name_snapshot, qty: it.quantity, price: it.unit_price_snapshot });
        }
      }

      const waiterRow = db.prepare('SELECT full_name FROM users WHERE id = ?').get(acc.waiter_id) as
        | { full_name: string }
        | undefined;
      const tableRow = acc.table_id
        ? (db.prepare('SELECT label FROM dining_tables WHERE id = ?').get(acc.table_id) as { label: string } | undefined)
        : undefined;

      const receiptPayload = {
        receiptNumber,
        orderCode: ordersForAcc.map((o) => o.order_code).join(', ') || accountId.slice(0, 8),
        tableLabel: tableRow?.label ?? 'PARA LLEVAR',
        customerName: acc.main_customer_name,
        waiterName: waiterRow?.full_name ?? 'Mozo',
        dateTime: now,
        items,
        total: Number(amountToApply.toFixed(2)),
        accountTotal: acc.total_amount,
        pendingAfter: newPending,
        received: Number(effectiveReceived.toFixed(2)),
        change: changeAmount,
        paymentMethod: method,
        validationCode: cleanCode || null,
      };

      const receiptId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO internal_receipts (id, receipt_number, account_id, payment_id, payload_json, issued_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(receiptId, receiptNumber, accountId, paymentId, JSON.stringify(receiptPayload), now, now);

      const responseObj = {
        status: 'PAID',
        paymentId,
        receiptId,
        receiptNumber,
        receiptPayload,
        changeAmount,
        pendingBalance: newPending,
      };
      saveIdempotency(idempotencyKey, 'PAYMENT', paymentId, responseObj);
      return responseObj;
    })();

    broadcastEvent('PAYMENT_REGISTERED', result);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// 9. Categorías y Productos (Solo Admin)
app.post('/api/categories', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { name, subtitle, sortOrder } = req.body as { name: string; subtitle?: string; sortOrder?: number };
  if (!name?.trim()) {
    res.status(400).json({ error: 'El nombre de categoría es obligatorio.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO categories (id, name, subtitle, sort_order, is_active, updated_at) VALUES (?, ?, ?, ?, 1, ?)').run(
    id,
    name.trim().toUpperCase(),
    subtitle?.trim() || null,
    sortOrder ?? 10,
    now
  );
  writeAuditLog(actor.id, 'CREAR_CATEGORIA', 'categories', id, { name });
  broadcastEvent('CATALOG_UPDATED', { id });
  res.status(201).json({ id });
});

app.post('/api/products', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { categoryId, name, description, price, imageUrl, requiresKitchen } = req.body as {
    categoryId: string;
    name: string;
    description?: string;
    price: number;
    imageUrl?: string | null;
    requiresKitchen?: boolean;
  };
  if (!name?.trim() || price < 0) {
    res.status(400).json({ error: 'Nombre y precio válido son obligatorios.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO products (id, category_id, name, description, price, image_url, is_available, requires_kitchen, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, categoryId, name.trim(), description?.trim() ?? '', Number(price.toFixed(2)), imageUrl ?? null, requiresKitchen !== false ? 1 : 0, now);

  writeAuditLog(actor.id, 'CREAR_PRODUCTO', 'products', id, { name, price });
  broadcastEvent('CATALOG_UPDATED', { id });
  res.status(201).json({ id });
});

app.patch('/api/products/:id', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;
  const { name, description, price, isAvailable, categoryId, imageUrl, requiresKitchen } = req.body as {
    name?: string;
    description?: string;
    price?: number;
    isAvailable?: boolean;
    categoryId?: string;
    imageUrl?: string | null;
    requiresKitchen?: boolean;
  };
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as
    | { id: string; name: string; description: string; price: number; is_available: number; category_id: string; image_url: string | null; requires_kitchen: number; version: number }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Producto no encontrado.' });
    return;
  }

  const now = new Date().toISOString();
  const newPrice = price !== undefined ? Number(price.toFixed(2)) : existing.price;
  if (newPrice < 0) {
    res.status(400).json({ error: 'El precio no puede ser negativo.' });
    return;
  }

  db.prepare(
    `UPDATE products
     SET name = ?, description = ?, price = ?, is_available = ?, category_id = ?, image_url = ?, requires_kitchen = ?, version = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    name?.trim() ?? existing.name,
    description !== undefined ? description.trim() : existing.description,
    newPrice,
    isAvailable !== undefined ? (isAvailable ? 1 : 0) : existing.is_available,
    categoryId ?? existing.category_id,
    imageUrl !== undefined ? imageUrl : existing.image_url,
    requiresKitchen !== undefined ? (requiresKitchen ? 1 : 0) : existing.requires_kitchen,
    existing.version + 1,
    now,
    id
  );

  writeAuditLog(actor.id, 'ACTUALIZAR_PRODUCTO', 'products', id, {
    oldPrice: existing.price,
    newPrice,
    isAvailable,
  });
  broadcastEvent('CATALOG_UPDATED', { id });
  res.json({ status: 'UPDATED' });
});

// 10. Inventario, Proveedores, Recetas, Compras y Mermas (Solo Admin)
app.post('/api/suppliers', requirePermission('ALL'), (req, res) => {
  const { name, rucOrDni, phone } = req.body as { name: string; rucOrDni?: string; phone?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Nombre de proveedor requerido.' });
    return;
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO suppliers (id, name, ruc_or_dni, phone, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name.trim(),
    rucOrDni?.trim() || null,
    phone?.trim() || null,
    new Date().toISOString()
  );
  broadcastEvent('INVENTORY_UPDATED', { id });
  res.status(201).json({ id });
});

app.post('/api/ingredients', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { category, name, unit, currentStock, minStock, lastPurchasePrice, supplierId, expirationDate } = req.body as {
    category: string;
    name: string;
    unit: 'kg' | 'g' | 'l' | 'ml' | 'unidad';
    currentStock?: number;
    minStock?: number;
    lastPurchasePrice?: number;
    supplierId?: string | null;
    expirationDate?: string | null;
  };
  if (!name?.trim() || !category?.trim()) {
    res.status(400).json({ error: 'Categoría y nombre de ingrediente son requeridos.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const stock = currentStock ?? 0;
  const price = lastPurchasePrice ?? 0;

  db.prepare(
    `INSERT INTO ingredients (id, category, name, unit, current_stock, min_stock, last_purchase_price, average_unit_cost, supplier_id, expiration_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, category.trim(), name.trim(), unit, stock, minStock ?? 0, price, price, supplierId || null, expirationDate || null, now);

  writeAuditLog(actor.id, 'CREAR_INGREDIENTE', 'ingredients', id, { name, category, unit });
  broadcastEvent('INVENTORY_UPDATED', { id });
  res.status(201).json({ id });
});

app.post('/api/recipes/:productId', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { productId } = req.params;
  const { items } = req.body as { items: Array<{ ingredientId: string; quantity: number }> };
  const now = new Date().toISOString();

  db.transaction(() => {
    let recipe = db.prepare('SELECT id, version FROM recipes WHERE product_id = ?').get(productId) as
      | { id: string; version: number }
      | undefined;

    if (!recipe) {
      const newId = crypto.randomUUID();
      db.prepare('INSERT INTO recipes (id, product_id, estimated_cost, updated_at) VALUES (?, ?, 0, ?)').run(
        newId,
        productId,
        now
      );
      recipe = { id: newId, version: 1 };
    } else {
      db.prepare('DELETE FROM recipe_items WHERE recipe_id = ?').run(recipe.id);
    }

    const insertRi = db.prepare(
      'INSERT INTO recipe_items (id, recipe_id, ingredient_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const it of items) {
      if (it.quantity > 0) {
        insertRi.run(crypto.randomUUID(), recipe.id, it.ingredientId, it.quantity, now);
      }
    }

    recalculateAllRecipeCosts();
    writeAuditLog(actor.id, 'CONFIGURAR_RECETA', 'recipes', recipe.id, { productId, itemCount: items.length });
  })();

  broadcastEvent('INVENTORY_UPDATED', { productId });
  res.json({ status: 'SAVED' });
});

app.post('/api/purchases', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { supplierId, ingredientId, quantity, unitPrice } = req.body as {
    supplierId: string;
    ingredientId: string;
    quantity: number;
    unitPrice: number;
  };
  if (quantity <= 0 || unitPrice < 0) {
    res.status(400).json({ error: 'Cantidad y precio unitario inválidos.' });
    return;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.transaction(() => {
    const ing = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(ingredientId) as
      | { id: string; name: string; unit: string; current_stock: number; average_unit_cost: number; version: number }
      | undefined;
    if (!ing) throw new Error('Ingrediente no encontrado.');

    const totalAmount = Number((quantity * unitPrice).toFixed(2));
    const existingPositiveStock = Math.max(0, ing.current_stock);
    const newTotalForAvg = existingPositiveStock + quantity;
    const newAvgCost =
      newTotalForAvg > 0
        ? Number((((existingPositiveStock * ing.average_unit_cost) + totalAmount) / newTotalForAvg).toFixed(4))
        : unitPrice;
    const newStock = Number((ing.current_stock + quantity).toFixed(4));

    db.prepare(
      `INSERT INTO purchases (id, supplier_id, ingredient_id, quantity, unit, unit_price, total_amount, registered_by_user_id, purchased_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, supplierId, ingredientId, quantity, ing.unit, unitPrice, totalAmount, actor.id, now, now);

    db.prepare(
      `UPDATE ingredients
       SET current_stock = ?, last_purchase_price = ?, average_unit_cost = ?, supplier_id = ?, version = ?, updated_at = ?
       WHERE id = ?`
    ).run(newStock, unitPrice, newAvgCost, supplierId, ing.version + 1, now, ingredientId);

    db.prepare(
      `INSERT INTO inventory_movements (id, ingredient_id, movement_type, quantity_delta, stock_after, user_id, reason, created_at, updated_at)
       VALUES (?, ?, 'COMPRA', ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      ingredientId,
      quantity,
      newStock,
      actor.id,
      `Compra de ${quantity} ${ing.unit} a S/ ${unitPrice.toFixed(2)}`,
      now,
      now
    );

    recalculateAllRecipeCosts();
    writeAuditLog(actor.id, 'REGISTRAR_COMPRA', 'purchases', id, { ingredient: ing.name, quantity, totalAmount });
  })();

  broadcastEvent('INVENTORY_UPDATED', { id });
  res.status(201).json({ id });
});

app.post('/api/inventory/adjust', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { ingredientId, movementType, quantity, reason } = req.body as {
    ingredientId: string;
    movementType: 'AJUSTE' | 'MERMA' | 'DEVOLUCION';
    quantity: number;
    reason: string;
  };
  if (!reason?.trim() || quantity === 0) {
    res.status(400).json({ error: 'Cantidad distinta de cero y motivo son obligatorios.' });
    return;
  }

  const now = new Date().toISOString();
  db.transaction(() => {
    const ing = db.prepare('SELECT id, current_stock, average_unit_cost, version FROM ingredients WHERE id = ?').get(ingredientId) as
      | { id: string; current_stock: number; average_unit_cost: number; version: number }
      | undefined;
    if (!ing) throw new Error('Ingrediente no encontrado.');

    const delta = movementType === 'MERMA' ? -Math.abs(quantity) : movementType === 'DEVOLUCION' ? Math.abs(quantity) : quantity;
    const newStock = Number((ing.current_stock + delta).toFixed(4));

    db.prepare('UPDATE ingredients SET current_stock = ?, version = ?, updated_at = ? WHERE id = ?').run(
      newStock,
      ing.version + 1,
      now,
      ingredientId
    );
    db.prepare(
      `INSERT INTO inventory_movements (id, ingredient_id, movement_type, quantity_delta, stock_after, user_id, reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), ingredientId, movementType, delta, newStock, actor.id, reason.trim(), now, now);

    if (movementType === 'MERMA') {
      db.prepare(
        `INSERT INTO waste_records (id, ingredient_id, quantity, estimated_loss, reason, registered_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        ingredientId,
        Math.abs(quantity),
        Number((Math.abs(quantity) * ing.average_unit_cost).toFixed(2)),
        reason.trim(),
        actor.id,
        now,
        now
      );
    }

    writeAuditLog(actor.id, `INVENTARIO_${movementType}`, 'ingredients', ingredientId, { delta, reason });
  })();

  broadcastEvent('INVENTORY_UPDATED', { ingredientId });
  res.json({ status: 'ADJUSTED' });
});

// 11. Usuarios y Respaldo (Solo Admin)
app.post('/api/users', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { fullName, username, password, roleId } = req.body as {
    fullName: string;
    username: string;
    password?: string;
    roleId: string;
  };
  const finalPassword = password?.trim() ? password.trim() : '1111';
  if (!fullName?.trim() || !username?.trim() || finalPassword.length < 4) {
    res.status(400).json({ error: 'Nombre completo, usuario y contraseña (mín. 4 caracteres, o 1111 por defecto) son obligatorios.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(
      'INSERT INTO users (id, role_id, full_name, username, password_hash, is_active, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
    ).run(id, roleId, fullName.trim(), username.trim(), hashPassword(finalPassword), now);
    writeAuditLog(actor.id, 'CREAR_USUARIO', 'users', id, { username, roleId });
    broadcastEvent('USERS_UPDATED', { id });
    res.status(201).json({ id });
  } catch {
    res.status(400).json({ error: `El nombre de usuario "${username}" ya existe.` });
  }
});

app.patch('/api/users/:id', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;
  const { fullName, isActive, password, roleId } = req.body as {
    fullName?: string;
    isActive?: boolean;
    password?: string;
    roleId?: string;
  };
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | { id: string; full_name: string; role_id: string; is_active: number; password_hash: string; version: number }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'Usuario no encontrado.' });
    return;
  }
  if (id === actor.id && isActive === false) {
    res.status(400).json({ error: 'No puedes desactivar tu propia cuenta de Administrador activa.' });
    return;
  }
  if (id === actor.id && roleId && roleId !== user.role_id) {
    res.status(400).json({ error: 'No puedes cambiar tu propio rol mientras estás conectado.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE users SET full_name = ?, role_id = ?, is_active = ?, password_hash = ?, version = ?, updated_at = ? WHERE id = ?'
  ).run(
    fullName?.trim() || user.full_name,
    roleId ?? user.role_id,
    isActive !== undefined ? (isActive ? 1 : 0) : user.is_active,
    password && password.length >= 4 ? hashPassword(password) : user.password_hash,
    user.version + 1,
    now,
    id
  );
  writeAuditLog(actor.id, 'ACTUALIZAR_USUARIO', 'users', id, {
    fullName: fullName?.trim(),
    isActive,
    roleId,
    passwordChanged: Boolean(password),
  });
  broadcastEvent('USERS_UPDATED', { id });
  res.json({ status: 'UPDATED' });
});

app.delete('/api/users/:id', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { id } = req.params;

  if (id === actor.id) {
    res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de Administrador activa.' });
    return;
  }

  const target = db.prepare('SELECT id, full_name, username FROM users WHERE id = ?').get(id) as
    | { id: string; full_name: string; username: string }
    | undefined;
  if (!target) {
    res.status(404).json({ error: 'Usuario no encontrado.' });
    return;
  }

  db.transaction(() => {
    // Reasignar referencias históricas al Administrador para conservar integridad de ventas/auditoría
    db.prepare('UPDATE accounts SET waiter_id = ? WHERE waiter_id = ?').run(actor.id, id);
    db.prepare('UPDATE orders SET waiter_id = ? WHERE waiter_id = ?').run(actor.id, id);
    db.prepare('UPDATE orders SET delivery_waiter_id = NULL WHERE delivery_waiter_id = ?').run(id);
    db.prepare('UPDATE cash_registers SET cashier_id = ? WHERE cashier_id = ?').run(actor.id, id);
    db.prepare('UPDATE payments SET registered_by_user_id = ? WHERE registered_by_user_id = ?').run(actor.id, id);
    db.prepare('UPDATE purchases SET registered_by_user_id = ? WHERE registered_by_user_id = ?').run(actor.id, id);
    db.prepare('UPDATE inventory_movements SET user_id = ? WHERE user_id = ?').run(actor.id, id);
    db.prepare('UPDATE waste_records SET registered_by_user_id = ? WHERE registered_by_user_id = ?').run(actor.id, id);
    db.prepare('UPDATE audit_logs SET user_id = ? WHERE user_id = ?').run(actor.id, id);

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    writeAuditLog(actor.id, 'ELIMINAR_USUARIO', 'users', id, {
      deletedUsername: target.username,
      deletedFullName: target.full_name,
    });
  })();

  broadcastEvent('USERS_UPDATED', { id });
  res.json({ status: 'DELETED' });
});

app.patch('/api/settings/app-gate', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username?.trim() && !password) {
    res.status(400).json({ error: 'Indica el nuevo usuario o contraseña general.' });
    return;
  }
  if (password && password.length < 4) {
    res.status(400).json({ error: 'La contraseña general debe tener al menos 4 caracteres.' });
    return;
  }
  const now = new Date().toISOString();
  const upsert = db.prepare(
    'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  );
  if (username?.trim()) {
    upsert.run('app_gate_username', username.trim(), now);
  }
  if (password) {
    upsert.run('app_gate_password_hash', hashPassword(password), now);
  }
  writeAuditLog(actor.id, 'ACTUALIZAR_CLAVE_GENERAL', 'system_settings', 'app_gate', {
    usernameUpdated: Boolean(username?.trim()),
    passwordUpdated: Boolean(password),
  });
  res.json({ status: 'UPDATED' });
});

app.get('/api/backup', requirePermission('ALL'), (req, res) => {
  const actor = getActorFromReq(req);
  writeAuditLog(actor.id, 'DESCARGAR_RESPALDO', 'database', 'la_dieta.db', {});
  res.json(buildBootstrapState());
});

// Montar Vite en desarrollo o servir /dist en producción
async function startServer(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT ?? 3000);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`LA DIETA POS Server listening on http://localhost:${PORT}`);
  });
}

startServer();
