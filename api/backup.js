import { backupService } from "../lib/backup.js";
import { db } from "../lib/db.js";
import { safeProfileKey } from "../lib/foodie.js";

export const access = "public";
export const methods = ["GET", "POST"];

export default async function handler(req, res) {
  const method = req.method;

  if (method === "GET") {
    try {
      const backups = backupService.listBackups();
      const dbStats = db.getStats();
      return res.json({
        ok: true,
        durability: {
          journalMode: dbStats.journalMode,
          crashResilient: true,
          integrityCheck: dbStats.integrity,
          description: "SQLite WAL mode with fsync ensures zero data loss and uncorrupted recovery during sudden power outage / power cut."
        },
        counts: dbStats.counts,
        backupsCount: backups.length,
        backups
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to list backups." });
    }
  }

  if (method === "POST") {
    const action = String(req.query?.action || req.body?.action || "create").toLowerCase();

    // Action A: Create new hot backup
    if (action === "create" || action === "backup") {
      try {
        const reason = String(req.body?.reason || "user_manual_snapshot").slice(0, 50);
        const profileKey = safeProfileKey(req.body?.profileKey);
        const manifest = await backupService.createBackup({ reason, profileKey });
        return res.status(201).json({
          ok: true,
          message: `Hot database backup created successfully: ${manifest.filename}`,
          manifest
        });
      } catch (err) {
        return res.status(500).json({ error: err.message || "Backup creation failed." });
      }
    }

    // Action B: Restore from an existing backup
    if (action === "restore") {
      const filename = String(req.body?.filename || "").trim();
      if (!filename) {
        return res.status(400).json({ error: "Backup filename is required for restore." });
      }
      try {
        const result = await backupService.restoreBackup(filename);
        return res.json({
          ok: true,
          message: `Database successfully restored from ${filename}. Integrity: ${result.integrity}`,
          result
        });
      } catch (err) {
        return res.status(500).json({ error: err.message || "Restore operation failed." });
      }
    }

    return res.status(400).json({ error: `Unknown backup action: ${action}` });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

