import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { db } from "./lib/db.js";
import { backupService } from "./lib/backup.js";

// Import API Handlers
import bootstrapHandler from "./api/bootstrap.js";
import recommendHandler from "./api/recommend.js";
import ordersHandler from "./api/orders.js";
import orderByIdHandler from "./api/orders/[id].js";
import preferencesHandler from "./api/preferences.js";
import notificationsHandler from "./api/notifications.js";
import demoResetHandler from "./api/demo-reset.js";
import agentChatHandler from "./api/agent-chat.js";
import backupHandler from "./api/backup.js";
import memoryHandler from "./api/memory.js";
import modelsHandler from "./api/models.js";
import healthHandler from "./api/health.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging in development
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (req.path.startsWith("/api/")) {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const color = status >= 400 ? "\x1b[31m" : "\x1b[32m";
      console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path} ${color}${status}\x1b[0m (${duration}ms)`);
    }
  });
  next();
});

// API Routes
app.get("/api/bootstrap", (req, res) => bootstrapHandler(req, res));
app.post("/api/recommend", (req, res) => recommendHandler(req, res));

app.get("/api/orders", (req, res) => ordersHandler(req, res));
app.post("/api/orders", (req, res) => ordersHandler(req, res));
app.get("/api/orders/:id", (req, res) => orderByIdHandler(req, res));
app.post("/api/orders/:id", (req, res) => orderByIdHandler(req, res));

app.get("/api/preferences", (req, res) => preferencesHandler(req, res));
app.put("/api/preferences", (req, res) => preferencesHandler(req, res));
app.delete("/api/preferences", (req, res) => preferencesHandler(req, res));

app.get("/api/notifications", (req, res) => notificationsHandler(req, res));
app.post("/api/notifications", (req, res) => notificationsHandler(req, res));

app.post("/api/demo-reset", (req, res) => demoResetHandler(req, res));
app.post("/api/agent-chat", (req, res) => agentChatHandler(req, res));

// Memory & LSTM Endpoints
app.get("/api/memory", (req, res) => memoryHandler(req, res));
app.post("/api/memory", (req, res) => memoryHandler(req, res));
app.delete("/api/memory", (req, res) => memoryHandler(req, res));

// Durability, Power-Loss Safety & Backup Endpoints
app.get("/api/backup", (req, res) => backupHandler(req, res));
app.post("/api/backup", (req, res) => backupHandler(req, res));

// Dynamic Models Configuration
app.get("/api/models", (req, res) => modelsHandler(req, res));

// System Observability, Health & Telemetry
app.get("/api/health", (req, res) => healthHandler(req, res));

// System & LLM Status check
app.get("/api/llm-status", (req, res) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const activeModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const stats = db.getStats();

  res.json({
    geminiConfigured: hasKey,
    activeMode: hasKey ? `Hybrid (${activeModel} + Deterministic Engine)` : "Deterministic Agent Mode (Rule Engine)",
    model: hasKey ? activeModel : "deterministic-rule-engine",
    dbEngine: "SQLite (Built-in node:sqlite)",
    journalMode: stats.journalMode,
    powerLossDurability: "WAL mode with fsync ensures zero corruption on sudden power loss",
    memoryArchitecture: "Dual-Tier (STM Working Memory + LTM Episodic/Semantic Memory)",
    integrity: stats.integrity,
    restaurantsCount: stats.counts.restaurants,
    menuItemsCount: stats.counts.menuItems
  });
});

// Serve static frontend files
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Fallback to index.html for client routes
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Endpoint not found" });
  }
  res.sendFile(path.join(publicDir, "index.html"));
});

// Start automated periodic backups (every 15 mins)
backupService.startAutoBackupSchedule({ intervalMinutes: 15 });

// Server startup
app.listen(PORT, () => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  console.log("\x1b[36m%s\x1b[0m", `
  ┌────────────────────────────────────────────────────────────┐
  │                                                            │
  │   🍕 FoodieAgent — Intelligent Food Ordering System v2.5  │
  │   Enterprise Edition: LSTM Memory + Power-Loss Backup      │
  │                                                            │
  ├────────────────────────────────────────────────────────────┤
  │   Local URL:    http://localhost:${PORT}                      │
  │   Project Guide:http://localhost:${PORT}/guide.html           │
  │   Viva Prep:    http://localhost:${PORT}/viva.html            │
  │   AI Model:     ${hasKey ? `⚡ Google ${model}` : "🛡️  Offline Deterministic"}             │
  │   Memory:       Dual-Tier (LTM Semantic + STM Working)     │
  │   Durability:   WAL Mode (Crash & Power-Cut Safe)          │
  │   Auto-Backup:  Active (Scheduled & On-Demand)             │
  └────────────────────────────────────────────────────────────┘
  `);
});
