import crypto from "node:crypto";
import { db } from "./db.js";
import { safeProfileKey, parseFoodRequest } from "./foodie.js";

// ============================================================================
// Long Short Term Memory (LSTM) Core Module
// Provides Short-Term Working Memory (STM) & Long-Term Episodic Memory (LTM)
// ============================================================================

export const memoryService = {
  // --------------------------------------------------------------------------
  // SHORT-TERM WORKING MEMORY (STM)
  // --------------------------------------------------------------------------

  /**
   * Retrieves or initializes a chat session with working context slots
   */
  async getOrCreateSession(profileKey, sessionId = null) {
    const key = safeProfileKey(profileKey);
    if (!key) throw new Error("A valid profile key is required.");

    let sid = String(sessionId || "").trim();
    if (!sid || sid.length < 6) {
      sid = "sess_" + crypto.randomUUID().slice(0, 12);
    }

    const { rows } = await db.query(
      "SELECT * FROM fa_chat_sessions WHERE session_id = $1 AND profile_key = $2",
      [sid, key]
    );

    if (rows.length) {
      let context = {};
      try { context = JSON.parse(rows[0].context_json || "{}"); } catch {}
      return {
        sessionId: rows[0].session_id,
        profileKey: rows[0].profile_key,
        activeIntent: rows[0].active_intent,
        context,
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at
      };
    }

    const initialContext = {
      activeCategory: null,
      activeBudgetRupees: null,
      activeDeadlineMinutes: null,
      activeDiet: null,
      activeCuisine: null,
      lastMentionedDishes: [],
      lastCheckoutTicket: null
    };

    await db.query(
      "INSERT INTO fa_chat_sessions (session_id, profile_key, active_intent, context_json, updated_at) VALUES ($1, $2, $3, $4, now())",
      [sid, key, "general", JSON.stringify(initialContext)]
    );

    return {
      sessionId: sid,
      profileKey: key,
      activeIntent: "general",
      context: initialContext,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  },

  /**
   * Updates working context slots in STM
   */
  async updateSessionContext(sessionId, profileKey, updates = {}, activeIntent = null) {
    const session = await this.getOrCreateSession(profileKey, sessionId);
    const merged = { ...session.context, ...updates };

    let intent = activeIntent || session.activeIntent;
    await db.query(
      "UPDATE fa_chat_sessions SET context_json = $1, active_intent = $2, updated_at = now() WHERE session_id = $3 AND profile_key = $4",
      [JSON.stringify(merged), intent, session.sessionId, session.profileKey]
    );

    return merged;
  },

  /**
   * Appends a message to the session dialogue history
   */
  async addChatMessage(sessionId, profileKey, role, content, metadata = {}) {
    const key = safeProfileKey(profileKey);
    const msgId = "msg_" + crypto.randomUUID().slice(0, 10);

    await db.query(
      "INSERT INTO fa_chat_messages (id, session_id, profile_key, role, content, metadata_json, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())",
      [msgId, sessionId, key, role, String(content), JSON.stringify(metadata)]
    );

    return {
      id: msgId,
      sessionId,
      profileKey: key,
      role,
      content,
      metadata,
      createdAt: new Date().toISOString()
    };
  },

  /**
   * Returns recent chat messages for context injection
   */
  async getSessionMessages(sessionId, profileKey, limit = 8) {
    const { rows } = await db.query(
      "SELECT id, role, content, metadata_json, created_at FROM fa_chat_messages WHERE session_id = $1 AND profile_key = $2 ORDER BY created_at DESC LIMIT $3",
      [sessionId, profileKey, limit]
    );

    return rows.reverse().map(r => {
      let meta = {};
      try { meta = JSON.parse(r.metadata_json || "{}"); } catch {}
      return {
        id: r.id,
        role: r.role,
        content: r.content,
        metadata: meta,
        createdAt: r.created_at
      };
    });
  },

  /**
   * Short-Term Memory Ellipsis & Anaphora Resolution
   * Understands relative utterances like "make it veg", "the first one", "under 300"
   */
  resolveContextualQuery(userMessage, currentContext = {}) {
    const low = userMessage.toLowerCase().trim();
    const ctx = currentContext || {};
    const parsed = parseFoodRequest(userMessage);

    const isOrderReference = /^(?:order|checkout|buy|get|take)\s+(?:the\s+)?(first|1st|second|2nd|third|3rd|that|this|it)\b/i.test(low);
    const isDirectConfirm = /^(?:confirm|yes confirm|place order|proceed with order|confirm order|yes please)\b/i.test(low);
    const isDietaryShift = /(?:make it|only|prefer|switch to)\s+(?:pure\s+)?(veg|vegetarian|non-veg|non-vegetarian)/i.test(low);
    const isBudgetShift = /(?:under|below|less than|budget)\s*[₹rs.]*\s*(\d[\d,]*)/i.test(low);
    const isTimeShift = /(?:within|in|under|before)\s*(\d+)\s*(?:minutes?|mins?)/i.test(low);

    let resolvedDish = null;
    let targetTicket = ctx.lastCheckoutTicket || null;

    if (isOrderReference) {
      const dishes = ctx.lastMentionedDishes || [];
      if (/first|1st/i.test(low) && dishes[0]) resolvedDish = dishes[0];
      else if (/second|2nd/i.test(low) && dishes[1]) resolvedDish = dishes[1];
      else if (/third|3rd/i.test(low) && dishes[2]) resolvedDish = dishes[2];
      else if (/that|this|it/i.test(low) && dishes[0]) resolvedDish = dishes[0];
    }

    const merged = {
      category: parsed.category || ctx.activeCategory || "pizza",
      budgetRupees: parsed.budgetPaise ? parsed.budgetPaise / 100 : (ctx.activeBudgetRupees || 500),
      deadlineMinutes: parsed.deadlineMinutes || ctx.activeDeadlineMinutes || 30,
      vegetarian: isDietaryShift
        ? !/non-veg|non-vegetarian/i.test(low)
        : (parsed.vegetarian !== null && parsed.vegetarian !== undefined ? parsed.vegetarian : (ctx.activeDiet !== null && ctx.activeDiet !== undefined ? ctx.activeDiet : true)),
      cuisine: parsed.cuisine || ctx.activeCuisine || "",
      isDirectConfirm,
      isOrderReference,
      resolvedDish,
      targetTicket
    };

    return merged;
  },

  // --------------------------------------------------------------------------
  // LONG-TERM PERSISTENT MEMORY (LTM)
  // --------------------------------------------------------------------------

  /**
   * Rule-based & pattern extraction of semantic memory facts from user statements
   */
  extractFactsFromText(text) {
    const low = text.toLowerCase().trim();
    const facts = [];

    // 1. Dietary Facts
    if (/\b(?:i am|i'm|strictly|always)\s+(?:pure\s+)?veg(?:etarian)?\b/i.test(low)) {
      facts.push({ category: "diet", key: "dietary_type", value: "Pure Vegetarian" });
    } else if (/\b(?:i am|i'm)\s+vegan\b/i.test(low)) {
      facts.push({ category: "diet", key: "dietary_type", value: "Vegan" });
    } else if (/\b(?:i eat|i love|prefer)\s+(?:chicken|non[\s-]veg|meat)\b/i.test(low)) {
      facts.push({ category: "diet", key: "dietary_type", value: "Non-Vegetarian" });
    }

    // 2. Allergies & Dislikes
    const allergyMatch = low.match(/\b(?:allergic to|no|avoid|cannot eat|allergic)\s+([a-zA-Z\s]+?)(?=[.,]|$|\b(?:and|with|having|but|for|my|usual)\b)/i);
    if (allergyMatch) {
      const allergen = allergyMatch[1].trim();
      if (allergen.length > 2 && allergen.length < 30) {
        facts.push({ category: "allergy", key: `allergy_${allergen.replace(/\s+/g, "_")}`, value: `Allergic to ${allergen}` });
      }
    }

    // 3. Usual Budget
    const budgetMatch = low.match(/\b(?:my budget is usually|usual budget(?: is)?|keep budget(?: to)?|budget is|budget of)\s*[₹rs.]*\s*(\d[\d,]*)/i);
    if (budgetMatch) {
      facts.push({ category: "budget", key: "usual_budget", value: `₹${budgetMatch[1]}` });
    }

    // 4. Spice Tolerance
    if (/\b(?:can't handle spice|no spice|mild spice only|mild food)\b/i.test(low)) {
      facts.push({ category: "spice", key: "spice_level", value: "mild" });
    } else if (/\b(?:love spicy|extra spicy|hot food|make it spicy)\b/i.test(low)) {
      facts.push({ category: "spice", key: "spice_level", value: "hot" });
    }

    // 5. Cuisine Affinity
    const cuisineMatch = low.match(/\b(?:love|prefer|favorite cuisine is)\s+(italian|indian|chinese|pan-asian|mexican|continental)\b/i);
    if (cuisineMatch) {
      facts.push({ category: "cuisine", key: "preferred_cuisine", value: cuisineMatch[1].toUpperCase() });
    }

    // 6. Favorite Dishes
    const favMatch = low.match(/\b(?:my favorite dish is|i love eating|always order)\s+(margherita|farmhouse|paneer tikka|pasta|burger)\b/i);
    if (favMatch) {
      facts.push({ category: "favorite_dish", key: `fav_${favMatch[1].replace(/\s+/g, "_")}`, value: favMatch[1] });
    }

    return facts;
  },

  /**
   * Persists extracted memory facts to SQLite LTM
   */
  async saveMemoryFact(profileKey, category, factKey, factValue, source = "chat_extractor") {
    const key = safeProfileKey(profileKey);
    const id = "fact_" + crypto.randomUUID().slice(0, 10);

    const { rows } = await db.query(
      `INSERT INTO fa_memory_facts (id, profile_key, category, fact_key, fact_value, confidence, source, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1.0, $6, now())
       ON CONFLICT (profile_key, category, fact_key) DO UPDATE SET
         fact_value = EXCLUDED.fact_value,
         source = EXCLUDED.source,
         updated_at = now()
       RETURNING *`,
      [id, key, category, factKey, String(factValue), source]
    );

    return rows[0];
  },

  /**
   * Deletes a specific memory fact
   */
  async deleteMemoryFact(profileKey, factId) {
    const key = safeProfileKey(profileKey);
    const { rows } = await db.query(
      "DELETE FROM fa_memory_facts WHERE (id = $1 OR fact_key = $1) AND profile_key = $2 RETURNING *",
      [factId, key]
    );
    return { ok: true, deleted: rows[0] || null };
  },

  /**
   * Compiles the full Long-Term Memory Profile
   */
  async getLTMProfile(profileKey) {
    const key = safeProfileKey(profileKey);
    if (!key) return null;

    const [prefRes, factsRes, ordersRes] = await Promise.all([
      db.query("SELECT * FROM fa_preferences WHERE profile_key = $1", [key]),
      db.query("SELECT * FROM fa_memory_facts WHERE profile_key = $1 ORDER BY updated_at DESC", [key]),
      db.query(
        "SELECT o.id, o.restaurant_id, r.name as restaurant_name, m.name as item_name, o.total_paise, o.created_at FROM fa_orders o JOIN fa_restaurants r ON r.id = o.restaurant_id JOIN fa_menu_items m ON m.id = o.menu_item_id WHERE o.profile_key = $1 ORDER BY o.created_at DESC LIMIT 15",
        [key]
      )
    ]);

    const pref = prefRes.rows[0] || null;
    const facts = factsRes.rows || [];
    const orders = ordersRes.rows || [];

    // Synthesize order habit insights
    const dishCounts = {};
    let totalSpendPaise = 0;
    for (const o of orders) {
      dishCounts[o.item_name] = (dishCounts[o.item_name] || 0) + 1;
      totalSpendPaise += Number(o.total_paise || 0);
    }
    const topDishes = Object.entries(dishCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => `${name} (${count}x)`);

    const avgSpendRupees = orders.length ? (totalSpendPaise / orders.length / 100).toFixed(0) : null;

    return {
      profileKey: key,
      preferences: pref ? {
        vegetarian: pref.vegetarian,
        usualBudgetRupees: pref.budget_paise ? Number(pref.budget_paise) / 100 : null,
        deliveryLimitMinutes: pref.delivery_limit_minutes,
        preferredCuisine: pref.cuisine,
        spiceLevel: pref.spice_level
      } : null,
      memoryFacts: facts.map(f => ({
        id: f.id,
        category: f.category,
        key: f.fact_key,
        value: f.fact_value,
        updatedAt: f.updated_at
      })),
      orderHabits: {
        totalOrdersCount: orders.length,
        averageOrderSpendRupees: avgSpendRupees,
        frequentDishes: topDishes
      }
    };
  },

  /**
   * Formats structured LTM + STM Context for LLM System Prompt injection
   */
  async formatMemoryPrompt(profileKey, sessionContext = null) {
    const ltm = await this.getLTMProfile(profileKey);
    let prompt = "\n\n### 🧠 Active Memory Architecture (Long-Term & Short-Term Working Memory):\n";

    if (!ltm || (!ltm.preferences && !ltm.memoryFacts.length && !ltm.orderHabits.totalOrdersCount)) {
      prompt += "- **Long-Term Memory (LTM)**: New user profile. No prior historical facts stored yet.\n";
    } else {
      prompt += "- **Long-Term Memory Profile (LTM)**:\n";
      if (ltm.preferences) {
        prompt += `  * Explicit Diet: ${ltm.preferences.vegetarian === true ? "Pure Vegetarian" : ltm.preferences.vegetarian === false ? "Non-Vegetarian allowed" : "Flexible"}\n`;
        if (ltm.preferences.usualBudgetRupees) prompt += `  * Usual Spending Target: ₹${ltm.preferences.usualBudgetRupees}\n`;
        if (ltm.preferences.deliveryLimitMinutes) prompt += `  * Preferred Max ETA: ${ltm.preferences.deliveryLimitMinutes} mins\n`;
        if (ltm.preferences.preferredCuisine) prompt += `  * Preferred Cuisine: ${ltm.preferences.preferredCuisine}\n`;
        if (ltm.preferences.spiceLevel) prompt += `  * Spice Tolerance: ${ltm.preferences.spiceLevel}\n`;
      }
      if (ltm.memoryFacts.length) {
        prompt += `  * Discovered Facts: ${ltm.memoryFacts.map(f => `[${f.category}: ${f.value}]`).join(", ")}\n`;
      }
      if (ltm.orderHabits.totalOrdersCount > 0) {
        prompt += `  * Order History: ${ltm.orderHabits.totalOrdersCount} completed orders (Average spend: ₹${ltm.orderHabits.averageOrderSpendRupees}). Favorites: ${ltm.orderHabits.frequentDishes.join(", ") || "None"}\n`;
      }
    }

    if (sessionContext) {
      prompt += "- **Short-Term Working Memory (STM)**:\n";
      if (sessionContext.activeCategory) prompt += `  * Active Category Focus: ${sessionContext.activeCategory}\n`;
      if (sessionContext.activeBudgetRupees) prompt += `  * Current Working Budget: ₹${sessionContext.activeBudgetRupees}\n`;
      if (sessionContext.activeDiet !== null) prompt += `  * Working Dietary Filter: ${sessionContext.activeDiet ? "Vegetarian" : "Non-Vegetarian"}\n`;
      if (sessionContext.lastMentionedDishes?.length) {
        prompt += `  * Recently Presented Dishes: ${sessionContext.lastMentionedDishes.map((d, i) => `#${i + 1} ${d.name} (₹${d.totalRupees || d.priceRupees})`).join(", ")}\n`;
      }
      if (sessionContext.lastCheckoutTicket) {
        prompt += `  * Pending Checkout Draft: ${sessionContext.lastCheckoutTicket.name} (Total: ₹${sessionContext.lastCheckoutTicket.totalRupees})\n`;
      }
    }

    prompt += "Use these memory insights proactively to personalize food recommendations and handle relative questions (e.g. 'the first one', 'make it veg', 'cheaper option').\n";
    return prompt;
  }
};

export default memoryService;
