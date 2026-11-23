import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'la_dieta.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const PASSWORD_SALT = 'LA_DIETA_SICUANI_2026_SALT';

export function hashPassword(raw: string): string {
  return crypto.createHash('sha256').update(`${PASSWORD_SALT}::${raw}`).digest('hex');
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      permissions_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id),
      full_name TEXT NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dining_tables (
      id TEXT PRIMARY KEY,
      number INTEGER UNIQUE NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'LIBRE',
      active_account_id TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      subtitle TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL,
      image_url TEXT,
      is_available INTEGER NOT NULL DEFAULT 1,
      requires_kitchen INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      table_id TEXT REFERENCES dining_tables(id),
      is_takeaway INTEGER NOT NULL DEFAULT 0,
      main_customer_name TEXT NOT NULL,
      waiter_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'ABIERTA',
      total_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_guests (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      guest_name TEXT NOT NULL,
      total_assigned REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      is_settled INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_code TEXT UNIQUE NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      table_id TEXT REFERENCES dining_tables(id),
      waiter_id TEXT NOT NULL REFERENCES users(id),
      delivery_waiter_id TEXT REFERENCES users(id),
      delivery_destination TEXT,
      waiter_confirmed_at TEXT,
      customer_name TEXT NOT NULL,
      kitchen_status TEXT NOT NULL DEFAULT 'NUEVO',
      inventory_deducted INTEGER NOT NULL DEFAULT 0,
      cancellation_reason TEXT,
      created_at TEXT NOT NULL,
      prep_started_at TEXT,
      ready_at TEXT,
      delivered_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      account_guest_id TEXT REFERENCES account_guests(id),
      product_name_snapshot TEXT NOT NULL,
      unit_price_snapshot REAL NOT NULL,
      quantity INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cash_registers (
      id TEXT PRIMARY KEY,
      cashier_id TEXT NOT NULL REFERENCES users(id),
      opening_balance REAL NOT NULL,
      expected_closing_balance REAL NOT NULL DEFAULT 0,
      declared_closing_balance REAL,
      difference REAL,
      status TEXT NOT NULL DEFAULT 'ABIERTA',
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      cash_register_id TEXT NOT NULL REFERENCES cash_registers(id),
      account_id TEXT REFERENCES accounts(id),
      account_guest_id TEXT REFERENCES account_guests(id),
      movement_type TEXT NOT NULL DEFAULT 'INGRESO_VENTA',
      method TEXT NOT NULL,
      amount REAL NOT NULL,
      received_amount REAL NOT NULL DEFAULT 0,
      change_amount REAL NOT NULL DEFAULT 0,
      reference_note TEXT,
      validation_code TEXT,
      proof_image_url TEXT,
      registered_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS internal_receipts (
      id TEXT PRIMARY KEY,
      receipt_number TEXT UNIQUE NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      payment_id TEXT NOT NULL REFERENCES payments(id),
      payload_json TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ruc_or_dni TEXT,
      phone TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      current_stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      last_purchase_price REAL NOT NULL DEFAULT 0,
      average_unit_cost REAL NOT NULL DEFAULT 0,
      supplier_id TEXT REFERENCES suppliers(id),
      expiration_date TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      product_id TEXT UNIQUE NOT NULL REFERENCES products(id),
      estimated_cost REAL NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipe_items (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL REFERENCES recipes(id),
      ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
      quantity REAL NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL REFERENCES suppliers(id),
      ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      unit_price REAL NOT NULL,
      total_amount REAL NOT NULL,
      registered_by_user_id TEXT NOT NULL REFERENCES users(id),
      purchased_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
      movement_type TEXT NOT NULL,
      quantity_delta REAL NOT NULL,
      stock_after REAL NOT NULL,
      order_id TEXT REFERENCES orders(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS waste_records (
      id TEXT PRIMARY KEY,
      ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
      order_id TEXT REFERENCES orders(id),
      quantity REAL NOT NULL,
      estimated_loss REAL NOT NULL,
      reason TEXT NOT NULL,
      registered_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      entity_name TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      idempotency_key TEXT PRIMARY KEY,
      entity_name TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      response_json TEXT,
      processed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS table_reservations (
      id TEXT PRIMARY KEY,
      table_id TEXT REFERENCES dining_tables(id),
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      service_mode TEXT NOT NULL DEFAULT 'EN_MESA',
      reservation_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_hours REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'PENDIENTE',
      notes TEXT NOT NULL DEFAULT '',
      pre_order_items_json TEXT,
      linked_order_id TEXT REFERENCES orders(id),
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const nowSettings = new Date().toISOString();
  const insertSettingIfMissing = db.prepare(
    'INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)'
  );
  insertSettingIfMissing.run('app_gate_username', 'admin', nowSettings);
  insertSettingIfMissing.run('app_gate_password_hash', hashPassword('admin'), nowSettings);
  insertSettingIfMissing.run('app_gate_secret', crypto.randomBytes(32).toString('hex'), nowSettings);

  const orderCols = db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>;
  if (!orderCols.some((c) => c.name === 'delivery_waiter_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_waiter_id TEXT REFERENCES users(id)');
  }
  if (!orderCols.some((c) => c.name === 'delivery_destination')) {
    db.exec('ALTER TABLE orders ADD COLUMN delivery_destination TEXT');
  }
  if (!orderCols.some((c) => c.name === 'waiter_confirmed_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN waiter_confirmed_at TEXT');
  }

  const paymentCols = db.prepare('PRAGMA table_info(payments)').all() as Array<{ name: string }>;
  if (!paymentCols.some((c) => c.name === 'validation_code')) {
    db.exec('ALTER TABLE payments ADD COLUMN validation_code TEXT');
  }
  if (!paymentCols.some((c) => c.name === 'proof_image_url')) {
    db.exec('ALTER TABLE payments ADD COLUMN proof_image_url TEXT');
  }

  seedInitialData();

  const passMigrated = db
    .prepare("SELECT value FROM system_settings WHERE key = 'default_passwords_1111_applied'")
    .get() as { value: string } | undefined;
  if (!passMigrated) {
    const nowPass = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ?').run(hashPassword('1111'), nowPass);
      db.prepare(
        "INSERT INTO system_settings (key, value, updated_at) VALUES ('default_passwords_1111_applied', '1', ?)"
      ).run(nowPass);
    })();
  }
}

function seedInitialData(): void {
  const existingCats = db.prepare('SELECT COUNT(*) as cnt FROM categories').get() as { cnt: number };
  if (existingCats.cnt > 0) return;

  const now = new Date().toISOString();

  const insertRole = db.prepare(
    'INSERT INTO roles (id, name, permissions_json, updated_at) VALUES (?, ?, ?, ?)'
  );
  const insertUser = db.prepare(
    'INSERT INTO users (id, role_id, full_name, username, password_hash, is_active, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  );
  const insertTable = db.prepare(
    'INSERT INTO dining_tables (id, number, label, status, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertCat = db.prepare(
    'INSERT INTO categories (id, name, subtitle, sort_order, is_active, updated_at) VALUES (?, ?, ?, ?, 1, ?)'
  );
  const insertProd = db.prepare(
    'INSERT INTO products (id, category_id, name, description, price, is_available, requires_kitchen, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  );
  const insertSupplier = db.prepare(
    'INSERT INTO suppliers (id, name, ruc_or_dni, phone, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertIngredient = db.prepare(
    'INSERT INTO ingredients (id, category, name, unit, current_stock, min_stock, last_purchase_price, average_unit_cost, supplier_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const tx = db.transaction(() => {
    // 1. Roles
    insertRole.run('role-admin', 'ADMINISTRADOR', JSON.stringify(['ALL']), now);
    insertRole.run(
      'role-mozo',
      'MOZO',
      JSON.stringify([
        'TABLES_VIEW',
        'CUSTOMERS_CREATE',
        'ORDERS_CREATE',
        'ORDERS_ADD_ITEMS',
        'KITCHEN_STATUS_VIEW',
        'ACCOUNTS_VIEW',
      ]),
      now
    );
    insertRole.run(
      'role-cocinero',
      'COCINERO',
      JSON.stringify(['KITCHEN_QUEUE_VIEW', 'ORDERS_STATUS_UPDATE']),
      now
    );
    insertRole.run(
      'role-cajero',
      'CAJERO',
      JSON.stringify([
        'TABLES_VIEW',
        'ACCOUNTS_VIEW',
        'ACCOUNTS_SPLIT',
        'PAYMENTS_REGISTER',
        'TICKETS_PRINT',
        'ACCOUNTS_CLOSE',
        'CASH_REGISTER_MANAGE',
      ]),
      now
    );

    // 2. Usuarios iniciales por perfil (contraseña por defecto 1111, modificable luego por el Administrador)
    insertUser.run('user-admin-1', 'role-admin', 'Administrador Principal', 'admin', hashPassword('1111'), now);
    insertUser.run('user-mozo-1', 'role-mozo', 'Carlos Quispe (Mozo)', 'mozo1', hashPassword('1111'), now);
    insertUser.run('user-cocina-1', 'role-cocinero', 'Lucía Mamani (Cocina)', 'cocina1', hashPassword('1111'), now);
    insertUser.run('user-caja-1', 'role-cajero', 'Mateo Condori (Caja)', 'caja1', hashPassword('1111'), now);

    // 3. Mesas configurables (01 a 10)
    for (let i = 1; i <= 10; i++) {
      const numStr = String(i).padStart(2, '0');
      insertTable.run(`table-${numStr}`, i, `Mesa ${numStr}`, 'LIBRE', now);
    }

    // 4. Categorías oficiales
    insertCat.run('cat-salchipapas', 'SALCHIPAPAS', 'El pecado más delicioso', 1, now);
    insertCat.run('cat-combinados', 'COMBINADOS', 'Para compartir... o no', 2, now);
    insertCat.run('cat-salchiconos', 'SALCHICONOS', 'El cono de la tentación', 3, now);
    insertCat.run('cat-bebidas-calientes', 'BEBIDAS CALIENTES', 'Para bajar la culpa', 4, now);
    insertCat.run('cat-bebidas-frias', 'BEBIDAS FRÍAS', 'Para bajar la culpa', 5, now);

    // 5. Carta Oficial Completa (19 productos con precios editables por Admin)
    const menuItems: Array<[string, string, string, string, number, number]> = [
      ['prod-fit', 'cat-salchipapas', 'La Dieta Fit', 'Papas fritas + salchicha (con menos culpa)', 6.0, 1],
      ['prod-gorda', 'cat-salchipapas', 'La Dieta Gorda Feliz', 'Papas fritas + salchicha + arroz chaufa', 6.0, 1],
      ['prod-triple', 'cat-salchipapas', 'La Triple Embriaguez', 'Papas fritas + salchicha + huevo', 8.0, 1],
      ['prod-estilo', 'cat-salchipapas', 'La Dieta con Estilo', 'Papas fritas + salchicha + arroz chaufa + huevo', 8.0, 1],
      ['prod-sin-limites', 'cat-salchipapas', 'La Dieta Sin Límites', 'Papas fritas + salchicha + pollo a la plancha', 10.0, 1],
      ['prod-full-power', 'cat-salchipapas', 'La Dieta Full Power', 'Papas fritas + salchicha + arroz chaufa + pollo a la plancha', 10.0, 1],
      ['prod-campeon', 'cat-salchipapas', 'La Dieta del Campeón', 'Papas fritas + salchicha + queso', 9.0, 1],
      ['prod-doble-queso', 'cat-salchipapas', 'La Dieta Doble Queso', 'Papas fritas + salchicha + doble queso', 9.0, 1],

      ['prod-mixto-perfecta', 'cat-combinados', 'Mixto Dieta Perfecta', 'Salchipapa con 2 combinaciones: pollo + huevo, pollo + queso o queso + huevo', 12.0, 1],
      ['prod-mixto-suprema', 'cat-combinados', 'Mixto Dieta Suprema', 'Salchipapa con pollo + queso + huevo', 15.0, 1],

      ['prod-salchicono', 'cat-salchiconos', 'Salchipapa en cono', 'Pequeño gusto... Gran felicidad', 3.0, 1],

      ['prod-manzanilla', 'cat-bebidas-calientes', 'Manzanilla', 'Infusión caliente reconfortante', 1.5, 0],
      ['prod-anis', 'cat-bebidas-calientes', 'Anís', 'Infusión caliente digestiva', 1.5, 0],
      ['prod-hierba-luisa', 'cat-bebidas-calientes', 'Hierba luisa', 'Infusión aromática caliente', 1.5, 0],
      ['prod-cafe', 'cat-bebidas-calientes', 'Café', 'Café pasado caliente', 3.0, 0],

      ['prod-agua', 'cat-bebidas-frias', 'Agua mineral', 'Botella personal helada o sin helar', 1.0, 0],
      ['prod-oro', 'cat-bebidas-frias', 'Gaseosa personal Oro', 'Botella personal', 1.0, 0],
      ['prod-inca', 'cat-bebidas-frias', 'Inca Kola personal', 'Botella personal', 3.0, 0],
      ['prod-coca', 'cat-bebidas-frias', 'Coca-Cola personal', 'Botella personal', 3.0, 0],
    ];

    for (const [id, catId, name, desc, price, reqKitchen] of menuItems) {
      insertProd.run(id, catId, name, desc, price, reqKitchen, now);
    }

    // 6. Proveedores base e ingredientes maestros (stock inicial 0, sin inventar recetas)
    insertSupplier.run('sup-sicuani', 'Mercado Central Sicuani', '10248851201', '984112233', now);
    insertSupplier.run('sup-distribuidora', 'Distribuidora Altiplano Sur', '20601144789', '963221100', now);

    const baseIngredients: Array<[string, string, string, string, number]> = [
      ['ing-papas', 'Papas', 'Papa Canchan / Amarilla', 'kg', 10],
      ['ing-salchicha', 'Salchichas', 'Salchicha Frankfurter', 'unidad', 20],
      ['ing-pollo', 'Pollo', 'Pechuga de Pollo', 'kg', 5],
      ['ing-queso', 'Queso', 'Queso Edam / Fresco', 'kg', 2],
      ['ing-huevos', 'Huevos', 'Huevo de Gallina', 'unidad', 30],
      ['ing-arroz', 'Arroz', 'Arroz Chaufa Preparado', 'kg', 4],
      ['ing-aceite', 'Aceite', 'Aceite Vegetal', 'l', 5],
      ['ing-salsas', 'Salsas', 'Cremas (Mayonesa / Ají / Ketchup)', 'ml', 1000],
      ['ing-envase', 'Envases', 'Envase Descartable / Cono', 'unidad', 50],
      ['ing-bebidas', 'Bebidas', 'Gaseosa / Agua Botella Personal', 'unidad', 24],
    ];

    for (const [id, cat, name, unit, minStock] of baseIngredients) {
      insertIngredient.run(id, cat, name, unit, 0, minStock, 0, 0, 'sup-sicuani', now);
    }
  });

  tx();
}
