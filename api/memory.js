import { memoryService } from "../lib/memory.js";
import { safeProfileKey } from "../lib/foodie.js";

export const access = "public";
export const methods = ["GET", "POST", "DELETE"];

export default async function handler(req, res) {
  const profileKey = safeProfileKey(
    req.method === "GET" ? req.query?.profileKey : req.body?.profileKey
  );

  if (!profileKey) {
    return res.status(400).json({ error: "A valid browser demo profile key is required." });
  }

  // 1. GET: Fetch full LSTM Profile (LTM + active STM session)
  if (req.method === "GET") {
    try {
      const sessionId = req.query?.sessionId;
      const [ltm, session] = await Promise.all([
        memoryService.getLTMProfile(profileKey),
        sessionId ? memoryService.getOrCreateSession(profileKey, sessionId) : null
      ]);

      let messages = [];
      if (session) {
        messages = await memoryService.getSessionMessages(session.sessionId, profileKey, 10);
      }

      return res.json({
        ok: true,
        profileKey,
        longTermMemory: ltm,
        shortTermMemory: session ? {
          sessionId: session.sessionId,
          activeIntent: session.activeIntent,
          workingContext: session.context,
          recentMessages: messages
        } : null
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to retrieve memory." });
    }
  }

  // 2. POST: Add or update explicit LTM fact or update STM slot
  if (req.method === "POST") {
    const b = req.body || {};
    const action = String(b.action || "save_fact").toLowerCase();

    try {
      if (action === "save_fact") {
        const category = String(b.category || "diet").toLowerCase();
        const key = String(b.key || "").trim().slice(0, 50);
        const value = String(b.value || "").trim().slice(0, 200);

        if (!key || !value) {
          return res.status(400).json({ error: "Fact key and value are required." });
        }

        const fact = await memoryService.saveMemoryFact(profileKey, category, key, value, "user_manual");
        return res.json({ ok: true, fact, message: "Fact persisted to Long-Term Memory (LTM)." });
      }

      if (action === "update_session") {
        const sessionId = b.sessionId;
        const updates = b.contextUpdates || {};
        const updated = await memoryService.updateSessionContext(sessionId, profileKey, updates);
        return res.json({ ok: true, workingContext: updated });
      }

      return res.status(400).json({ error: `Unknown memory action: ${action}` });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Memory mutation failed." });
    }
  }

  // 3. DELETE: Delete a specific memory fact
  if (req.method === "DELETE") {
    const factId = String(req.query?.factId || req.body?.factId || "").trim();
    if (!factId) {
      return res.status(400).json({ error: "factId is required to delete memory fact." });
    }
    try {
      const resDel = await memoryService.deleteMemoryFact(profileKey, factId);
      return res.json({ ok: true, deleted: resDel.deleted, message: "Fact removed from memory." });
    } catch (err) {
      return res.status(500).json({ error: err.message || "Failed to remove memory fact." });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

