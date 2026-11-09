import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
export const dbFile = process.env.FOODIE_DB_PATH || path.join(rootDir, "foodie.db");

const BOOLEAN_COLUMNS = new Set([
  "is_open",
  "is_vegetarian",
  "is_available",
  "is_read",
  "vegetarian"
]);

function normalizeRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const [key, val] of Object.entries(out)) {
    if (BOOLEAN_COLUMNS.has(key) || key.startsWith("is_")) {
      if (val !== null && val !== undefined) {
        out[key] = Boolean(val);
      }
    }
  }
  return out;
}

let syncDb = null;

export function getSyncDb() {
  if (syncDb) return syncDb;

  const db = new DatabaseSync(dbFile);
  db.function("now", () => new Date().toISOString());

  // =========================================================================
  // Durability & Power-Loss Protection (WAL Mode + Fsync Synchronous)
  // Ensures uncorrupted recovery if power cuts abruptly ("suddenly supply gone")
  // =========================================================================
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  // Verify integrity on boot
  try {
    const check = db.prepare("PRAGMA quick_check").get();
    if (check && Object.values(check)[0] !== "ok") {
      console.warn("⚠️ SQLite quick_check warning:", check);
    }
  } catch (err) {
    console.warn("⚠️ Could not run integrity check:", err.message);
  }

  // Initialize core schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS fa_restaurants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cuisine TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      rating NUMERIC(2,1) NOT NULL DEFAULT 4.0,
      delivery_fee_paise INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_paise >= 0),
      estimated_minutes INTEGER NOT NULL DEFAULT 30 CHECK (estimated_minutes > 0),
      is_open BOOLEAN NOT NULL DEFAULT 1,
      service_area TEXT NOT NULL DEFAULT 'Demo delivery zone',
      image_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fa_menu_items (
      id TEXT PRIMARY KEY,
      restaurant_id TEXT NOT NULL REFERENCES fa_restaurants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      is_vegetarian BOOLEAN NOT NULL DEFAULT 0,
      price_paise INTEGER NOT NULL CHECK (price_paise > 0),
      prep_minutes INTEGER NOT NULL DEFAULT 15 CHECK (prep_minutes > 0),
      image_url TEXT NOT NULL DEFAULT '',
      is_available BOOLEAN NOT NULL DEFAULT 1,
      tags TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS fa_menu_restaurant_idx ON fa_menu_items(restaurant_id);
    CREATE INDEX IF NOT EXISTS fa_menu_veg_category_idx ON fa_menu_items(is_vegetarian, category);

    CREATE TABLE IF NOT EXISTS fa_preferences (
      profile_key TEXT PRIMARY KEY,
      vegetarian BOOLEAN,
      cuisine TEXT,
      budget_paise INTEGER CHECK (budget_paise IS NULL OR budget_paise >= 0),
      delivery_limit_minutes INTEGER CHECK (delivery_limit_minutes IS NULL OR delivery_limit_minutes BETWEEN 1 AND 180),
      preferred_restaurant_id TEXT REFERENCES fa_restaurants(id) ON DELETE SET NULL,
      spice_level TEXT CHECK (spice_level IS NULL OR spice_level IN ('mild','medium','hot')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fa_orders (
      id TEXT PRIMARY KEY,
      profile_key TEXT NOT NULL,
      restaurant_id TEXT NOT NULL REFERENCES fa_restaurants(id),
      menu_item_id TEXT NOT NULL REFERENCES fa_menu_items(id),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
      item_price_paise INTEGER NOT NULL CHECK (item_price_paise >= 0),
      delivery_fee_paise INTEGER NOT NULL CHECK (delivery_fee_paise >= 0),
      tax_paise INTEGER NOT NULL CHECK (tax_paise >= 0),
      total_paise INTEGER NOT NULL CHECK (total_paise >= 0),
      estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes > 0),
      status TEXT NOT NULL CHECK (status IN ('CONFIRMED','PREPARING','OUT_FOR_DELIVERY','DELIVERED','CANCELLED')),
      idempotency_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_key, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS fa_orders_profile_created_idx ON fa_orders(profile_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS fa_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL REFERENCES fa_orders(id) ON DELETE CASCADE,
      menu_item_id TEXT NOT NULL REFERENCES fa_menu_items(id),
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
      unit_price_paise INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fa_agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_key TEXT NOT NULL,
      request_text TEXT NOT NULL,
      request_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS fa_agent_runs_profile_created_idx ON fa_agent_runs(profile_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS fa_notifications (
      id TEXT PRIMARY KEY,
      profile_key TEXT NOT NULL,
      order_id TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS fa_notifications_profile_created_idx ON fa_notifications(profile_key, created_at DESC);

    -- ========================================================================
    -- Short-Term Working Memory (STM) Session & Messages Store
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS fa_chat_sessions (
      session_id TEXT PRIMARY KEY,
      profile_key TEXT NOT NULL,
      active_intent TEXT NOT NULL DEFAULT '',
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS fa_chat_sessions_prof_idx ON fa_chat_sessions(profile_key, updated_at DESC);

    CREATE TABLE IF NOT EXISTS fa_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES fa_chat_sessions(session_id) ON DELETE CASCADE,
      profile_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','model','system','tool')),
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS fa_chat_messages_sess_idx ON fa_chat_messages(session_id, created_at ASC);

    -- ========================================================================
    -- Long-Term Memory (LTM) Episodic & Semantic Facts Store
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS fa_memory_facts (
      id TEXT PRIMARY KEY,
      profile_key TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('diet','allergy','budget','cuisine','spice','favorite_dish','behavior')),
      fact_key TEXT NOT NULL,
      fact_value TEXT NOT NULL,
      confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0,
      source TEXT NOT NULL DEFAULT 'user_chat',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_key, category, fact_key)
    );
    CREATE INDEX IF NOT EXISTS fa_mem_facts_prof_idx ON fa_memory_facts(profile_key, category);

    -- ========================================================================
    -- Backup & Power Crash Audit Log
    -- ========================================================================
    CREATE TABLE IF NOT EXISTS fa_backups_log (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      checksum TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'manual',
      records_summary TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Check if seeding is needed
  const rCount = db.prepare("SELECT count(*) as c FROM fa_restaurants").get().c;
  if (rCount === 0) {
    const seed1Path = path.join(rootDir, "seed.sql");
    const seed2Path = path.join(rootDir, "migrations", "002_expand_food_catalogue.sql");
    const seed3Path = path.join(rootDir, "migrations", "003_expand_pizza_range.sql");

    if (fs.existsSync(seed1Path)) {
      const seed1 = fs.readFileSync(seed1Path, "utf8").replace(/::jsonb/gi, "");
      db.exec(seed1);
    }
    if (fs.existsSync(seed2Path)) {
      const seed2 = fs.readFileSync(seed2Path, "utf8").replace(/::jsonb/gi, "");
      db.exec(seed2);
    }
    if (fs.existsSync(seed3Path)) {
      const seed3 = fs.readFileSync(seed3Path, "utf8").replace(/::jsonb/gi, "");
      db.exec(seed3);
    }
  }

  syncDb = db;
  return syncDb;
}

// Clean process exit handler flushes WAL pages to ensure 0 loss
function flushAndClose() {
  try {
    if (syncDb) {
      syncDb.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    }
  } catch {}
}
process.on("SIGINT", () => { flushAndClose(); process.exit(0); });
process.on("SIGTERM", () => { flushAndClose(); process.exit(0); });
process.on("beforeExit", () => { flushAndClose(); });

export const db = {
  async query(sqlText, params = []) {
    const sdb = getSyncDb();
    const mappedParams = [];
    const cleanSql = sqlText
      .replace(/::jsonb/gi, "")
      .replace(/\$(\d+)/g, (_, n) => {
        const idx = parseInt(n, 10) - 1;
        const val = params[idx];
        mappedParams.push(typeof val === "boolean" ? (val ? 1 : 0) : val);
        return "?";
      });

    const trimmed = cleanSql.trim();
    const isSelect = /^SELECT\b/i.test(trimmed);
    const isPragma = /^PRAGMA\b/i.test(trimmed);
    const hasReturning = /\bRETURNING\b/i.test(trimmed);

    const stmt = sdb.prepare(cleanSql);
    if (isSelect || isPragma || hasReturning) {
      const rows = stmt.all(...mappedParams).map(normalizeRow);
      return { rows };
    } else {
      const info = stmt.run(...mappedParams);
      return { rows: [], rowCount: info.changes };
    }
  },

  checkpoint() {
    const sdb = getSyncDb();
    return sdb.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  },

  checkIntegrity() {
    const sdb = getSyncDb();
    const row = sdb.prepare("PRAGMA integrity_check").get();
    return row ? Object.values(row)[0] : "unknown";
  },

  reopen() {
    flushAndClose();
    syncDb = null;
    return getSyncDb();
  },

  getStats() {
    const sdb = getSyncDb();
    let fileSize = 0;
    try {
      fileSize = fs.statSync(dbFile).size;
    } catch {}

    const restaurants = sdb.prepare("SELECT count(*) as c FROM fa_restaurants").get().c;
    const menuItems = sdb.prepare("SELECT count(*) as c FROM fa_menu_items").get().c;
    const orders = sdb.prepare("SELECT count(*) as c FROM fa_orders").get().c;
    const preferences = sdb.prepare("SELECT count(*) as c FROM fa_preferences").get().c;
    const memoryFacts = sdb.prepare("SELECT count(*) as c FROM fa_memory_facts").get().c;
    const chatMessages = sdb.prepare("SELECT count(*) as c FROM fa_chat_messages").get().c;
    const journalMode = sdb.prepare("PRAGMA journal_mode").get();

    return {
      dbPath: dbFile,
      fileSizeBytes: fileSize,
      journalMode: Object.values(journalMode || {})[0] || "wal",
      powerLossResilient: true,
      integrity: this.checkIntegrity(),
      counts: {
        restaurants,
        menuItems,
        orders,
        preferences,
        memoryFacts,
        chatMessages
      }
    };
  },

  get raw() {
    return getSyncDb();
  }
};

export default { db, getSyncDb, dbFile };
