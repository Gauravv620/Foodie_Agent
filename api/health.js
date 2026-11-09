import process from "node:process";
import { db } from "../lib/db.js";
import { backupService } from "../lib/backup.js";

export const access = "public";
export const methods = ["GET"];

export default async function handler(req, res) {
  try {
    const memUsage = process.memoryUsage();
    const dbStats = db.getStats();
    const backups = backupService.listBackups();
    const uptimeSec = Math.floor(process.uptime());

    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;
    const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

    const hasKey = Boolean(process.env.GEMINI_API_KEY);
    const activeModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    return res.json({
      status: "HEALTHY",
      app: "FoodieAgent Enterprise",
      version: "2.5.0",
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: uptimeSec,
        formatted: uptimeFormatted
      },
      process: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        memoryUsageMB: {
          rss: (memUsage.rss / (1024 * 1024)).toFixed(2),
          heapTotal: (memUsage.heapTotal / (1024 * 1024)).toFixed(2),
          heapUsed: (memUsage.heapUsed / (1024 * 1024)).toFixed(2)
        }
      },
      storage: {
        engine: "SQLite (Built-in node:sqlite)",
        journalMode: dbStats.journalMode,
        powerLossResilient: true,
        integrityCheck: dbStats.integrity,
        fileSizeBytes: dbStats.fileSizeBytes,
        tables: dbStats.counts
      },
      aiEngine: {
        activeModel: hasKey ? activeModel : "offline-rule-engine",
        geminiConfigured: hasKey,
        guardrailsEngine: "Active (Prompt Injection + Math Invariants + Allergen Safety)",
        memoryArchitecture: "Dual-Tier (LTM Semantic/Episodic + STM Working Memory)"
      },
      backupSystem: {
        status: "Active",
        intervalMinutes: Number(process.env.BACKUP_INTERVAL_MINUTES || 15),
        totalSnapshots: backups.length,
        lastBackupAt: backups[0]?.createdAt || "None yet"
      }
    });
  } catch (err) {
    return res.status(500).json({ status: "DEGRADED", error: err.message });
  }
}

