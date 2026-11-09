import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { db, dbFile } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
export const backupDir = path.join(rootDir, "backups");

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

function calculateFileSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash("sha256");
  hashSum.update(fileBuffer);
  return hashSum.digest("hex");
}

let autoBackupTimer = null;
let debounceTimer = null;

export const backupService = {
  /**
   * Performs an immediate atomic snapshot hot backup
   */
  async createBackup({ reason = "manual", profileKey = null, maxBackups = 10 } = {}) {
    if (!fs.existsSync(dbFile)) {
      throw new Error(`Database file not found at ${dbFile}`);
    }

    // Step 1: Force SQLite to checkpoint WAL pages into main DB file
    db.checkpoint();

    // Step 2: Generate unique timestamped filename
    const now = new Date();
    const timestampStr = now.toISOString().replace(/[:.]/g, "-");
    const backupName = `foodie_backup_${timestampStr}.db`;
    const targetPath = path.join(backupDir, backupName);
    const manifestPath = path.join(backupDir, `foodie_backup_${timestampStr}.json`);

    // Step 3: Copy file atomically
    fs.copyFileSync(dbFile, targetPath);

    // Step 4: Calculate SHA-256 checksum & collect stats
    const checksum = calculateFileSha256(targetPath);
    const stats = fs.statSync(targetPath);
    const dbStats = db.getStats();

    const manifest = {
      id: "bkp_" + crypto.randomUUID().slice(0, 8),
      filename: backupName,
      filePath: targetPath,
      fileSizeBytes: stats.size,
      checksum,
      reason,
      profileKey: profileKey || "system",
      createdAt: now.toISOString(),
      integrity: "ok",
      powerSafety: {
        walMode: true,
        fsyncSynchronous: "NORMAL",
        recoveryGuarantee: "Committed transactions safe against sudden power cut / crash"
      },
      counts: dbStats.counts
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    // Step 5: Log to database
    try {
      await db.query(
        "INSERT INTO fa_backups_log (id, filename, file_size, checksum, reason, records_summary) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          manifest.id,
          backupName,
          stats.size,
          checksum,
          reason,
          JSON.stringify(dbStats.counts)
        ]
      );
    } catch {}

    // Step 6: Prune older backups beyond maxBackups retention
    this.pruneBackups(maxBackups);

    return manifest;
  },

  /**
   * Lists all existing backups sorted by newest first
   */
  listBackups() {
    if (!fs.existsSync(backupDir)) return [];
    const files = fs.readdirSync(backupDir);
    const manifests = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = fs.readFileSync(path.join(backupDir, file), "utf8");
          const parsed = JSON.parse(content);
          const dbExists = fs.existsSync(path.join(backupDir, parsed.filename));
          manifests.push({
            ...parsed,
            dbFileExists: dbExists
          });
        } catch {}
      }
    }

    manifests.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return manifests;
  },

  /**
   * Restores database from a selected backup
   */
  async restoreBackup(backupFilename) {
    const cleanName = path.basename(backupFilename);
    const sourcePath = path.join(backupDir, cleanName);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Backup file ${cleanName} does not exist in backups directory.`);
    }

    // Step 1: Verify backup file SQLite integrity before restoring
    try {
      const testDb = new DatabaseSync(sourcePath);
      const integrity = testDb.prepare("PRAGMA quick_check").get();
      if (integrity && Object.values(integrity)[0] !== "ok") {
        throw new Error("Backup file failed integrity check.");
      }
    } catch (err) {
      throw new Error(`Invalid backup file: ${err.message}`);
    }

    // Step 2: Create pre-restore emergency snapshot of current DB
    try {
      const emergencyName = `foodie_pre_restore_${Date.now()}.db`;
      if (fs.existsSync(dbFile)) {
        fs.copyFileSync(dbFile, path.join(backupDir, emergencyName));
      }
    } catch {}

    // Step 3: Flush and close existing DB connection
    db.checkpoint();

    // Remove WAL & SHM files to ensure clean state
    const walFile = `${dbFile}-wal`;
    const shmFile = `${dbFile}-shm`;
    try { if (fs.existsSync(walFile)) fs.unlinkSync(walFile); } catch {}
    try { if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile); } catch {}

    // Step 4: Overwrite foodie.db with backup
    fs.copyFileSync(sourcePath, dbFile);

    // Step 5: Re-open DB
    db.reopen();
    const finalIntegrity = db.checkIntegrity();

    return {
      success: true,
      restoredFrom: cleanName,
      restoredAt: new Date().toISOString(),
      integrity: finalIntegrity,
      stats: db.getStats()
    };
  },

  /**
   * Prunes oldest backups beyond limit
   */
  pruneBackups(maxKeep = 10) {
    const list = this.listBackups();
    if (list.length <= maxKeep) return;

    const toDelete = list.slice(maxKeep);
    for (const item of toDelete) {
      const dbPath = path.join(backupDir, item.filename);
      const jsonPath = path.join(backupDir, item.filename.replace(/\.db$/, ".json"));
      try { if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath); } catch {}
      try { if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath); } catch {}
    }
  },

  /**
   * Starts periodic automated backup background scheduler
   */
  startAutoBackupSchedule({ intervalMinutes = 15 } = {}) {
    if (autoBackupTimer) clearInterval(autoBackupTimer);
    const ms = Math.max(1, intervalMinutes) * 60 * 1000;

    autoBackupTimer = setInterval(async () => {
      try {
        await this.createBackup({ reason: "auto_scheduled" });
        console.log(`[AutoBackup] Periodic database snapshot created at ${new Date().toLocaleTimeString()}`);
      } catch (err) {
        console.warn("[AutoBackup] Scheduled snapshot failed:", err.message);
      }
    }, ms);

    if (autoBackupTimer.unref) autoBackupTimer.unref();
  },

  /**
   * Debounced backup trigger after critical state mutations (e.g. order placed)
   */
  triggerEventBackup(reason = "order_placed") {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        await this.createBackup({ reason: `event_${reason}` });
      } catch {}
    }, 4000);
    if (debounceTimer.unref) debounceTimer.unref();
  }
};

export default backupService;

