import { db } from "../lib/db.js";
import {
  safeProfileKey,
  parseFoodRequest,
  search_restaurants,
  get_restaurant_menu,
  filter_vegetarian_items,
  filter_non_vegetarian_items,
  calculate_total_price,
  check_delivery_estimate,
  create_order,
  get_order_status
} from "../lib/foodie.js";
import { memoryService } from "../lib/memory.js";
import { backupService } from "../lib/backup.js";
import { guardrails } from "../lib/guardrails.js";

export const access = "public";
export const methods = ["POST"];

// Format helpers
const toRupees = (paise) => (Number(paise || 0) / 100).toFixed(2);
const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);

// ============================================================================
// Comprehensive Tools Suite (Callable by Gemini LLM & Deterministic Engine)
// ============================================================================
const tools = {
  // 1. Search Restaurants
  async search_restaurants({ cuisine = "", maxDeliveryMinutes = null, minRating = null }) {
    let sql = "SELECT id, name, cuisine, description, rating, delivery_fee_paise, estimated_minutes, is_open, service_area, image_url FROM fa_restaurants WHERE is_open = 1";
    const params = [];
    if (cuisine) {
      sql += " AND lower(cuisine) LIKE lower($1)";
      params.push(`%${cuisine}%`);
    }
    const { rows } = await db.query(sql, params);
    let filtered = rows;
    if (maxDeliveryMinutes) {
      filtered = filtered.filter(r => r.estimated_minutes <= Number(maxDeliveryMinutes));
    }
    if (minRating) {
      filtered = filtered.filter(r => Number(r.rating) >= Number(minRating));
    }
    return {
      count: filtered.length,
      restaurants: filtered.map(r => ({
        id: r.id,
        name: r.name,
        cuisine: r.cuisine,
        rating: Number(r.rating),
        estimatedMinutes: r.estimated_minutes,
        deliveryFeeRupees: toRupees(r.delivery_fee_paise),
        serviceArea: r.service_area,
        description: r.description
      }))
    };
  },

  // 2. Get Restaurant Menu
  async get_restaurant_menu({ restaurantId, category = "", isVegetarian = null }) {
    if (!restaurantId) return { error: "restaurantId is required" };
    let sql = `
      SELECT m.*, r.name as restaurant_name, r.delivery_fee_paise 
      FROM fa_menu_items m 
      JOIN fa_restaurants r ON r.id = m.restaurant_id 
      WHERE (m.restaurant_id = $1 OR lower(r.name) LIKE lower($2)) AND m.is_available = 1
    `;
    const params = [restaurantId, `%${restaurantId}%`];
    const { rows } = await db.query(sql, params);
    let items = rows;
    if (category) {
      items = items.filter(m => m.category.toLowerCase().includes(category.toLowerCase()));
    }
    if (isVegetarian !== null && isVegetarian !== undefined) {
      items = items.filter(m => Boolean(m.is_vegetarian) === Boolean(isVegetarian));
    }
    return {
      count: items.length,
      restaurantName: items[0]?.restaurant_name || restaurantId,
      items: items.map(m => ({
        id: m.id,
        name: m.name,
        description: m.description,
        category: m.category,
        isVegetarian: Boolean(m.is_vegetarian),
        priceRupees: toRupees(m.price_paise),
        prepMinutes: m.prep_minutes,
        restaurantName: m.restaurant_name
      }))
    };
  },

  // 3. Get Dish Details
  async get_dish_details({ dishName = "", dishId = "" }) {
    let sql = `
      SELECT m.*, r.name as restaurant_name, r.rating as restaurant_rating, r.delivery_fee_paise, r.estimated_minutes as restaurant_eta, r.service_area
      FROM fa_menu_items m
      JOIN fa_restaurants r ON r.id = m.restaurant_id
      WHERE (m.id = $1 OR lower(m.name) LIKE lower($2))
      LIMIT 1
    `;
    const { rows } = await db.query(sql, [dishId, `%${dishName || dishId}%`]);
    if (!rows.length) return { found: false, message: `Dish '${dishName || dishId}' not found in catalogue.` };

    const m = rows[0];
    const total = calculate_total_price({
      unitPricePaise: Number(m.price_paise),
      quantity: 1,
      deliveryFeePaise: Number(m.delivery_fee_paise)
    });
    const eta = Math.max(Number(m.restaurant_eta), Number(m.prep_minutes) + 8);

    return {
      found: true,
      id: m.id,
      name: m.name,
      description: m.description,
      category: m.category,
      isVegetarian: Boolean(m.is_vegetarian),
      restaurantId: m.restaurant_id,
      restaurantName: m.restaurant_name,
      restaurantRating: Number(m.restaurant_rating),
      priceRupees: toRupees(m.price_paise),
      deliveryFeeRupees: toRupees(m.delivery_fee_paise),
      taxRupees: toRupees(total.taxPaise),
      totalRupees: toRupees(total.totalPaise),
      totalPaise: total.totalPaise,
      prepMinutes: m.prep_minutes,
      estimatedDeliveryMinutes: eta,
      serviceArea: m.service_area,
      imageUrl: m.image_url
    };
  },

  // 4. Compare Dishes
  async compare_dishes({ dishNameA, dishNameB }) {
    const [dishA, dishB] = await Promise.all([
      tools.get_dish_details({ dishName: dishNameA }),
      tools.get_dish_details({ dishName: dishNameB })
    ]);

    if (!dishA.found || !dishB.found) {
      return {
        error: `Could not compare. ${!dishA.found ? `Dish '${dishNameA}' not found. ` : ''}${!dishB.found ? `Dish '${dishNameB}' not found.` : ''}`
      };
    }

    const priceDiff = Number(dishA.totalRupees) - Number(dishB.totalRupees);
    const etaDiff = dishA.estimatedDeliveryMinutes - dishB.estimatedDeliveryMinutes;

    return {
      comparison: {
        dishA: {
          name: dishA.name,
          restaurant: dishA.restaurantName,
          rating: dishA.restaurantRating,
          diet: dishA.isVegetarian ? "Vegetarian" : "Non-Vegetarian",
          totalRupees: dishA.totalRupees,
          estimatedMinutes: dishA.estimatedDeliveryMinutes,
          description: dishA.description
        },
        dishB: {
          name: dishB.name,
          restaurant: dishB.restaurantName,
          rating: dishB.restaurantRating,
          diet: dishB.isVegetarian ? "Vegetarian" : "Non-Vegetarian",
          totalRupees: dishB.totalRupees,
          estimatedMinutes: dishB.estimatedDeliveryMinutes,
          description: dishB.description
        },
        verdict: {
          cheaper: priceDiff < 0 ? dishA.name : priceDiff > 0 ? dishB.name : "Both equal",
          faster: etaDiff < 0 ? dishA.name : etaDiff > 0 ? dishB.name : "Both equal",
          higherRated: dishA.restaurantRating > dishB.restaurantRating ? dishA.restaurantName : dishB.restaurantRating > dishA.restaurantRating ? dishB.restaurantName : "Both equal"
        }
      }
    };
  },

  // 5. Find Best Food Options (Multi-Agent Recommendation Engine)
  async find_best_food_options({ requestText = "", budgetRupees = 500, deadlineMinutes = 30, vegetarian = true, category = "pizza", cuisine = "" }) {
    const budgetPaise = Math.round(Number(budgetRupees || 500) * 100);
    const deadline = Number(deadlineMinutes || 30);
    const veg = Boolean(vegetarian);

    const restaurants = await search_restaurants({ cuisine });
    const menuGroups = await Promise.all(
      restaurants.map(async r => ({
        restaurant: r,
        menu: await get_restaurant_menu(r.id)
      }))
    );

    const candidates = [];
    for (const group of menuGroups) {
      const r = group.restaurant;
      if (!r.is_open) continue;

      const catItems = group.menu.filter(m => !category || m.category === category);
      const dietItems = veg
        ? await filter_vegetarian_items(catItems)
        : await filter_non_vegetarian_items(catItems);

      for (const m of dietItems) {
        if (!m.is_available) continue;
        const total = calculate_total_price({
          unitPricePaise: Number(m.price_paise),
          quantity: 1,
          deliveryFeePaise: Number(r.delivery_fee_paise)
        });
        const eta = await check_delivery_estimate(r.id, m.id);

        const eligible = total.totalPaise <= budgetPaise && eta.minutes <= deadline;
        const priceScore = Math.max(0, Math.min(100, Math.round(100 * (1 - total.totalPaise / budgetPaise))));
        const deliveryScore = Math.max(0, Math.min(100, Math.round(100 * (1 - eta.minutes / deadline))));
        const ratingScore = Math.max(0, Math.min(100, Math.round((Number(r.rating) / 5) * 100)));
        const score = Math.round(priceScore * 0.40 + deliveryScore * 0.35 + ratingScore * 0.25);

        if (eligible) {
          candidates.push({
            id: m.id,
            name: m.name,
            description: m.description,
            category: m.category,
            isVegetarian: Boolean(m.is_vegetarian),
            restaurantId: r.id,
            restaurantName: r.name,
            restaurantRating: Number(r.rating),
            priceRupees: toRupees(m.price_paise),
            deliveryFeeRupees: toRupees(r.delivery_fee_paise),
            taxRupees: toRupees(total.taxPaise),
            totalRupees: toRupees(total.totalPaise),
            totalPaise: total.totalPaise,
            estimatedMinutes: eta.minutes,
            score,
            imageUrl: m.image_url
          });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score || a.totalPaise - b.totalPaise);
    return {
      count: candidates.length,
      topMatches: candidates.slice(0, 10),
      allMatches: candidates
    };
  },

  // 6. Suggest Combos
  async suggest_combos({ baseItemId, budgetRupees = 500, vegetarian = true }) {
    const budgetPaise = Math.round(Number(budgetRupees || 500) * 100);
    const { rows: itemRows } = await db.query(
      "SELECT m.*, r.delivery_fee_paise, r.name as restaurant_name FROM fa_menu_items m JOIN fa_restaurants r ON r.id = m.restaurant_id WHERE (m.id = $1 OR lower(m.name) LIKE lower($2))",
      [baseItemId, `%${baseItemId}%`]
    );
    if (!itemRows.length) return { error: "Base item not found" };
    const baseItem = itemRows[0];

    const baseTotal = calculate_total_price({
      unitPricePaise: Number(baseItem.price_paise),
      quantity: 1,
      deliveryFeePaise: Number(baseItem.delivery_fee_paise)
    });

    const remainingBudgetPaise = budgetPaise - baseTotal.totalPaise;
    if (remainingBudgetPaise <= 0) {
      return {
        baseItem: baseItem.name,
        baseTotalRupees: toRupees(baseTotal.totalPaise),
        combosPossible: false,
        message: "Base item uses entire budget. No budget headroom for combos."
      };
    }

    const { rows: addonRows } = await db.query(
      "SELECT id, name, category, price_paise, is_vegetarian, prep_minutes FROM fa_menu_items WHERE restaurant_id = $1 AND id != $2 AND is_available = 1 AND category IN ('side','drink','dessert','snack','shake')",
      [baseItem.restaurant_id, baseItem.id]
    );

    const validAddons = addonRows.filter(a => {
      if (vegetarian && !a.is_vegetarian) return false;
      const addedTax = Math.round(Number(a.price_paise) * 0.05);
      const addedTotal = Number(a.price_paise) + addedTax;
      return addedTotal <= remainingBudgetPaise;
    });

    return {
      baseItem: baseItem.name,
      baseTotalRupees: toRupees(baseTotal.totalPaise),
      remainingHeadroomRupees: toRupees(remainingBudgetPaise),
      compatibleAddons: validAddons.map(a => ({
        id: a.id,
        name: a.name,
        category: a.category,
        priceRupees: toRupees(a.price_paise),
        comboTotalRupees: toRupees(baseTotal.totalPaise + Number(a.price_paise) + Math.round(Number(a.price_paise) * 0.05))
      }))
    };
  },

  // 7. Track User Orders
  async track_user_orders({ profileKey }) {
    const key = safeProfileKey(profileKey);
    if (!key) return { error: "Invalid profile key" };

    const { rows } = await db.query(
      "SELECT o.*, r.name as restaurant_name, m.name as item_name, m.image_url FROM fa_orders o JOIN fa_restaurants r ON r.id=o.restaurant_id JOIN fa_menu_items m ON m.id=o.menu_item_id WHERE o.profile_key=$1 ORDER BY o.created_at DESC LIMIT 5",
      [key]
    );

    return {
      count: rows.length,
      orders: rows.map(o => ({
        id: o.id,
        itemName: o.item_name,
        restaurantName: o.restaurant_name,
        quantity: o.quantity,
        totalRupees: toRupees(o.total_paise),
        status: o.status,
        estimatedMinutes: o.estimated_minutes,
        imageUrl: o.image_url,
        createdAt: o.created_at
      }))
    };
  },

  // 8. Get User Memory & Preferences (LTM)
  async get_user_memory({ profileKey }) {
    const key = safeProfileKey(profileKey);
    if (!key) return { error: "Invalid profile key" };
    const ltm = await memoryService.getLTMProfile(key);
    return {
      memory: ltm
    };
  },

  // 9. Save User Preferences
  async save_user_preferences({ profileKey, vegetarian = null, cuisine = null, budgetRupees = null, deadlineMinutes = null, spiceLevel = null }) {
    const key = safeProfileKey(profileKey);
    if (!key) return { error: "Invalid profile key" };
    const budgetPaise = budgetRupees != null ? Math.round(Number(budgetRupees) * 100) : null;
    const { rows } = await db.query(
      `INSERT INTO fa_preferences (profile_key, vegetarian, cuisine, budget_paise, delivery_limit_minutes, spice_level, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (profile_key) DO UPDATE SET
         vegetarian = COALESCE(EXCLUDED.vegetarian, fa_preferences.vegetarian),
         cuisine = COALESCE(EXCLUDED.cuisine, fa_preferences.cuisine),
         budget_paise = COALESCE(EXCLUDED.budget_paise, fa_preferences.budget_paise),
         delivery_limit_minutes = COALESCE(EXCLUDED.delivery_limit_minutes, fa_preferences.delivery_limit_minutes),
         spice_level = COALESCE(EXCLUDED.spice_level, fa_preferences.spice_level),
         updated_at = now()
       RETURNING *`,
      [key, vegetarian, cuisine, budgetPaise, deadlineMinutes, spiceLevel]
    );
    const p = rows[0];
    backupService.triggerEventBackup("preference_updated");
    return {
      success: true,
      message: "Preferences updated in persistent memory.",
      preferences: {
        vegetarian: p.vegetarian,
        usualBudgetRupees: p.budget_paise ? Number(p.budget_paise) / 100 : null,
        deliveryLimitMinutes: p.delivery_limit_minutes,
        preferredCuisine: p.cuisine,
        spiceLevel: p.spice_level
      }
    };
  },

  // 10. Prepare Order Checkout Draft
  async prepare_order_checkout({ dishId, dishName = "", quantity = 1, profileKey }) {
    const dish = await tools.get_dish_details({ dishId, dishName });
    if (!dish.found) return { error: `Could not prepare checkout: ${dish.message}` };

    const qty = Math.max(1, Math.min(10, Math.round(Number(quantity || 1))));
    const bill = calculate_total_price({
      unitPricePaise: dish.totalPaise - (Number(dish.deliveryFeeRupees) * 100) - (Number(dish.taxRupees) * 100),
      quantity: qty,
      deliveryFeePaise: toPaise(dish.deliveryFeeRupees)
    });

    return {
      checkoutTicket: {
        dishId: dish.id,
        name: dish.name,
        restaurantId: dish.restaurantId,
        restaurantName: dish.restaurantName,
        restaurantRating: dish.restaurantRating,
        quantity: qty,
        unitPriceRupees: dish.priceRupees,
        subtotalRupees: toRupees(bill.subtotalPaise),
        deliveryFeeRupees: dish.deliveryFeeRupees,
        taxRupees: toRupees(bill.taxPaise),
        totalRupees: toRupees(bill.totalPaise),
        totalPaise: bill.totalPaise,
        estimatedMinutes: dish.estimatedDeliveryMinutes,
        imageUrl: dish.imageUrl,
        isVegetarian: dish.isVegetarian
      }
    };
  }
};

// ============================================================================
// Gemini Function Declarations for Function Calling
// ============================================================================
const geminiFunctionDeclarations = [
  {
    name: "find_best_food_options",
    description: "Search and rank eligible food options using the multi-agent coordinator. Validates dietary criteria, delivery deadline, and budget headroom.",
    parameters: {
      type: "OBJECT",
      properties: {
        budgetRupees: { type: "NUMBER", description: "Maximum budget in Indian Rupees (e.g. 500)" },
        deadlineMinutes: { type: "NUMBER", description: "Delivery deadline in minutes (e.g. 30)" },
        vegetarian: { type: "BOOLEAN", description: "Must be vegetarian food (true or false)" },
        category: { type: "STRING", description: "Food category: pizza, burger, wrap, pasta, noodles, salad, roll, dessert, etc." },
        cuisine: { type: "STRING", description: "Preferred cuisine (e.g. Italian, Fusion)" }
      },
      required: ["budgetRupees", "deadlineMinutes"]
    }
  },
  {
    name: "get_dish_details",
    description: "Retrieve comprehensive specifications for any dish: ingredients, exact price breakdown (food + delivery + 5% tax), restaurant name, rating, prep time, and delivery window.",
    parameters: {
      type: "OBJECT",
      properties: {
        dishName: { type: "STRING", description: "Name or keyword of the dish (e.g. Farmhouse Veg Pizza, Classic Margherita)" },
        dishId: { type: "STRING", description: "Optional dish identifier" }
      },
      required: ["dishName"]
    }
  },
  {
    name: "compare_dishes",
    description: "Compare two dishes side-by-side on price, delivery time, restaurant rating, diet, and value.",
    parameters: {
      type: "OBJECT",
      properties: {
        dishNameA: { type: "STRING", description: "Name of the first dish" },
        dishNameB: { type: "STRING", description: "Name of the second dish" }
      },
      required: ["dishNameA", "dishNameB"]
    }
  },
  {
    name: "suggest_combos",
    description: "Find budget-compatible combos (sides, drinks, desserts) from the same restaurant that fit inside remaining budget headroom.",
    parameters: {
      type: "OBJECT",
      properties: {
        baseItemId: { type: "STRING", description: "Name or ID of the main dish" },
        budgetRupees: { type: "NUMBER", description: "Total user budget in Rupees" },
        vegetarian: { type: "BOOLEAN", description: "Whether addon must be vegetarian" }
      },
      required: ["baseItemId", "budgetRupees"]
    }
  },
  {
    name: "search_restaurants",
    description: "Search open restaurants by cuisine, minimum rating, or delivery timeframe.",
    parameters: {
      type: "OBJECT",
      properties: {
        cuisine: { type: "STRING", description: "Cuisine name like Italian, Pizza, Burgers" },
        maxDeliveryMinutes: { type: "NUMBER", description: "Max estimated delivery time" },
        minRating: { type: "NUMBER", description: "Minimum restaurant rating (e.g. 4.5)" }
      }
    }
  },
  {
    name: "get_restaurant_menu",
    description: "Retrieve complete menu items for a specific restaurant.",
    parameters: {
      type: "OBJECT",
      properties: {
        restaurantId: { type: "STRING", description: "Restaurant name or ID (e.g. Slice Society, Green Slice)" },
        category: { type: "STRING", description: "Optional category filter (e.g. pizza, side, drink)" },
        isVegetarian: { type: "BOOLEAN", description: "Filter by vegetarian flag" }
      },
      required: ["restaurantId"]
    }
  },
  {
    name: "track_user_orders",
    description: "Track status of the user's active and recent simulated orders, showing delivery progress and ETA.",
    parameters: {
      type: "OBJECT",
      properties: {}
    }
  },
  {
    name: "get_user_memory",
    description: "Inspect the user's Long-Term Memory (LTM) profile, including discovered dietary habits, allergies, past order patterns, and usual budget.",
    parameters: {
      type: "OBJECT",
      properties: {}
    }
  },
  {
    name: "save_user_preferences",
    description: "Update the user's long-term persistent preferences (diet, budget, cuisine, spice level).",
    parameters: {
      type: "OBJECT",
      properties: {
        vegetarian: { type: "BOOLEAN", description: "Dietary preference" },
        cuisine: { type: "STRING", description: "Preferred cuisine" },
        budgetRupees: { type: "NUMBER", description: "Usual budget in Rupees" },
        deadlineMinutes: { type: "NUMBER", description: "Delivery deadline in minutes" },
        spiceLevel: { type: "STRING", description: "mild, medium, or hot" }
      }
    }
  },
  {
    name: "prepare_order_checkout",
    description: "Prepares a structured checkout ticket with total bill and confirmation button for the user to review in chat.",
    parameters: {
      type: "OBJECT",
      properties: {
        dishName: { type: "STRING", description: "Name of the dish to order" },
        quantity: { type: "NUMBER", description: "Number of portions (default 1)" }
      },
      required: ["dishName"]
    }
  }
];

// ============================================================================
// Intelligent Offline Intent Router & Agent Engine (Powered by STM & LTM)
// ============================================================================
async function offlineAgent({ message, profileKey, session }) {
  const low = message.toLowerCase().trim();
  const toolTrace = [];
  let replyText = "";
  let cards = [];
  let checkoutTicket = null;
  let orderTrackingData = null;
  const ctx = session.context || {};

  // Auto-extract LTM facts from utterance
  const discoveredFacts = memoryService.extractFactsFromText(message);
  for (const f of discoveredFacts) {
    await memoryService.saveMemoryFact(profileKey, f.category, f.key, f.value, "offline_chat_extractor");
    toolTrace.push({ name: "saveMemoryFact", status: "complete", fact: f });
  }

  // Resolve multi-turn context (STM working memory)
  const contextual = memoryService.resolveContextualQuery(message, ctx);

  // Intent A: Order Tracking
  if (/where is my order|track my order|order status|track order|my orders|active order/i.test(low)) {
    const ordersRes = await tools.track_user_orders({ profileKey });
    toolTrace.push({ name: "track_user_orders", status: "complete", resultCount: ordersRes.count });

    if (ordersRes.count === 0) {
      replyText = "🧾 **You have no recent demo orders.**\n\nTo place one, simply ask me for a recommendation (e.g. *'Order a vegetarian pizza under ₹500 in 30 mins'*) or pick an item from the Discover tab!";
    } else {
      orderTrackingData = ordersRes.orders;
      const latest = ordersRes.orders[0];
      replyText = `📦 **Found ${ordersRes.count} recent demo order(s)** for this profile.\n\n**Latest Order #${latest.id}**:\n- **Item**: ${latest.itemName} × ${latest.quantity}\n- **Restaurant**: ${latest.restaurantName}\n- **Total Bill**: ₹${latest.totalRupees}\n- **Current Status**: **${latest.status}**\n- **Estimated Delivery**: ${latest.estimatedMinutes} mins\n\n*You can track real-time milestones in the Orders tab or use the simulation button!*`;
    }
    return { reply: replyText, model: "Offline Intent Agent (Rule Engine)", toolCalls: toolTrace, recommendedCards: cards, orderTrackingData };
  }

  // Intent B: Memory / Preferences Inquiry
  if (/my preferences|saved memory|what do you remember|stored preferences|my memory|who am i/i.test(low)) {
    const memRes = await tools.get_user_memory({ profileKey });
    const ltm = memRes.memory;
    toolTrace.push({ name: "get_user_memory", status: "complete", factsCount: ltm?.memoryFacts?.length || 0 });

    if (!ltm?.preferences && !ltm?.memoryFacts?.length && !ltm?.orderHabits?.totalOrdersCount) {
      replyText = "🧠 **No saved preferences or memory facts yet.**\n\nYou can set preferences in the **Memory & tools** tab, or tell me here: *'Remember that I prefer vegetarian Italian food with a budget of ₹450'*.";
    } else {
      replyText = `🧠 **Here is what I remember about you from Persistent Memory (LTM):**\n`;
      if (ltm.preferences) {
        replyText += `\n**Explicit Preferences**:\n- **Dietary Choice**: ${ltm.preferences.vegetarian === true ? "Pure Vegetarian" : ltm.preferences.vegetarian === false ? "No Veg-Only Rule" : "Not set"}\n- **Usual Budget**: ${ltm.preferences.usualBudgetRupees ? `₹${ltm.preferences.usualBudgetRupees}` : "Not set"}\n- **Delivery Limit**: ${ltm.preferences.deliveryLimitMinutes ? `${ltm.preferences.deliveryLimitMinutes} minutes` : "Not set"}\n- **Preferred Cuisine**: ${ltm.preferences.preferredCuisine || "Any"}\n- **Spice Level**: ${ltm.preferences.spiceLevel || "Medium"}\n`;
      }
      if (ltm.memoryFacts.length > 0) {
        replyText += `\n**Discovered Memory Facts**:\n` + ltm.memoryFacts.map(f => `- **${f.category.toUpperCase()}**: ${f.value}`).join("\n");
      }
      if (ltm.orderHabits?.totalOrdersCount > 0) {
        replyText += `\n\n**Order Habit Insights**:\n- **Total Orders**: ${ltm.orderHabits.totalOrdersCount}\n- **Avg. Order Spend**: ₹${ltm.orderHabits.averageOrderSpendRupees}\n- **Top Favorites**: ${ltm.orderHabits.frequentDishes.join(", ") || "None"}`;
      }
      replyText += `\n\n*These insights are backed by SQLite Write-Ahead Logging for power-loss durability!*`;
    }
    return { reply: replyText, model: "Offline Intent Agent (Rule Engine)", toolCalls: toolTrace, recommendedCards: cards };
  }

  // Intent C: Direct In-Chat Order Confirmation ("Yes confirm" / "Proceed with order")
  if (contextual.isDirectConfirm && ctx.lastCheckoutTicket) {
    const t = ctx.lastCheckoutTicket;
    try {
      const order = await create_order({
        profileKey,
        restaurantId: t.restaurantId,
        menuItemId: t.dishId,
        quantity: t.quantity || 1,
        confirmed: true,
        idempotencyKey: "DEMO_CHAT_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        budgetPaise: Math.round(Number(t.totalRupees) * 100) + 10000,
        deadlineMinutes: t.estimatedMinutes + 15,
        vegetarianRequired: t.isVegetarian
      });

      backupService.triggerEventBackup("chat_order_confirmed");
      replyText = `🎉 **Order Confirmed & Placed!**\n\n- **Order ID**: **#${order.id}**\n- **Item**: ${order.item_name} × ${order.quantity}\n- **Restaurant**: ${order.restaurant_name}\n- **Total Bill**: ₹${toRupees(order.total_paise)}\n- **Status**: **${order.status}**\n- **Estimated Delivery**: ${order.estimated_minutes} minutes\n\n*Your order is safely recorded in SQLite WAL mode. You can track live delivery progress in the Orders tab!*`;

      await memoryService.updateSessionContext(session.sessionId, profileKey, {
        lastCheckoutTicket: null
      });

      return {
        reply: replyText,
        model: "Offline Intent Agent (Rule Engine)",
        toolCalls: [{ name: "create_order", status: "complete", orderId: order.id }],
        recommendedCards: [t]
      };
    } catch (err) {
      replyText = `⚠️ Could not place order: ${err.message}`;
      return { reply: replyText, model: "Offline Intent Agent (Rule Engine)", toolCalls: toolTrace };
    }
  }

  // Intent D: Anaphoric Order Reference ("Order the first one" / "Order that")
  if (contextual.isOrderReference && contextual.resolvedDish) {
    const dish = contextual.resolvedDish;
    const ticketRes = await tools.prepare_order_checkout({ dishId: dish.id, dishName: dish.name, profileKey });
    if (ticketRes.checkoutTicket) {
      checkoutTicket = ticketRes.checkoutTicket;
      await memoryService.updateSessionContext(session.sessionId, profileKey, {
        lastCheckoutTicket: checkoutTicket
      });

      replyText = `📋 **Order Ticket Prepared for ${checkoutTicket.name}!**\n\n- **Restaurant**: ${checkoutTicket.restaurantName} (★ ${checkoutTicket.restaurantRating})\n- **Food Price**: ₹${checkoutTicket.unitPriceRupees}\n- **Delivery Fee**: ₹${checkoutTicket.deliveryFeeRupees}\n- **Assumed 5% Food Tax**: ₹${checkoutTicket.taxRupees}\n- **Total Payable**: **₹${checkoutTicket.totalRupees}**\n- **Estimated Delivery**: ${checkoutTicket.estimatedMinutes} minutes\n\nClick **'Confirm & Place Order'** below or reply **'Confirm'** to place this order!`;
      return { reply: replyText, model: "Offline Intent Agent (Rule Engine)", toolCalls: [{ name: "prepare_order_checkout", status: "complete" }], recommendedCards: [checkoutTicket], checkoutTicket };
    }
  }

  // Intent E: Dish Comparison ("Compare X and Y")
  const compareMatch = low.match(/compare\s+(?:the\s+)?(.+?)\s+(?:and|with|vs|versus)\s+(.+)/i);
  if (compareMatch) {
    const dishA = compareMatch[1].trim();
    const dishB = compareMatch[2].trim();
    const compRes = await tools.compare_dishes({ dishNameA: dishA, dishNameB: dishB });
    toolTrace.push({ name: "compare_dishes", status: "complete", result: compRes });

    if (compRes.error) {
      replyText = `⚠️ ${compRes.error}\n\n*Tip: Try comparing specific menu dishes like 'Compare Farmhouse Veg Pizza and Classic Margherita'!*`;
    } else {
      const { dishA: a, dishB: b, verdict: v } = compRes.comparison;
      replyText = `📊 **Side-by-Side Comparison:**\n\n| Feature | ${a.name} | ${b.name} |\n| :--- | :--- | :--- |\n| **Restaurant** | ${a.restaurant} (★ ${a.rating}) | ${b.restaurant} (★ ${b.rating}) |\n| **Dietary** | ${a.diet} | ${b.diet} |\n| **Total Price** | **₹${a.totalRupees}** | **₹${b.totalRupees}** |\n| **Est. Delivery** | ${a.estimatedMinutes} mins | ${b.estimatedMinutes} mins |\n\n💡 **Verdict**:\n- **Cheaper Option**: ${v.cheaper}\n- **Faster Delivery**: ${v.faster}\n- **Higher Rated Venue**: ${v.higherRated}`;
    }
    return { reply: replyText, model: "Offline Intent Agent (Rule Engine)", toolCalls: toolTrace, recommendedCards: cards };
  }

  // Intent F: Dish Details Inquiry ("Tell me about X")
  const detailsMatch = low.match(/(?:tell me about|what is|details of|specs of|info on|describe|is (.+) vegetarian)\s+(?:the\s+)?(.+)/i);
  if (detailsMatch) {
    const dishQuery = (detailsMatch[2] || detailsMatch[1] || "").replace(/\?$/, "").trim();
    const dish = await tools.get_dish_details({ dishName: dishQuery });
    if (dish.found) {
      toolTrace.push({ name: "get_dish_details", status: "complete", found: true });
      replyText = `🍽️ **${dish.name}** (${dish.isVegetarian ? "🟢 Pure Vegetarian" : "🔴 Non-Vegetarian"})\n\n${dish.description}\n\n- **Restaurant**: ${dish.restaurantName} (★ ${dish.restaurantRating})\n- **Food Price**: ₹${dish.priceRupees}\n- **Delivery Fee**: ₹${dish.deliveryFeeRupees}\n- **Assumed 5% Food Tax**: ₹${dish.taxRupees}\n- **Final Total Bill**: **₹${dish.totalRupees}**\n- **Estimated Delivery**: ${dish.estimatedDeliveryMinutes} mins (${dish.prepMinutes} min kitchen prep)\n- **Service Zone**: ${dish.serviceArea}\n\n*Would you like me to prepare an order for ${dish.name}?*`;
      cards = [dish];
      return { reply: replyText, model: "Offline Intent Agent (Rule Engine)", toolCalls: toolTrace, recommendedCards: cards };
    }
  }

  // Intent G: Restaurant Menu Lookup
  const restMatch = low.match(/(?:menu of|restaurant|about|what does)\s+(?:the\s+)?(slice society|oven & olive|green slice|pune pizza works|burger junction|bun theory|wrap street|bombay roll co|pasta pantry|noodle garden|green bowl cafe|spice route kitchen|tandoori town|dessert district|brew & bites|crunch corner)(?:\s+serve)?/i);
  if (restMatch) {
    const restName = restMatch[1].trim();
    const menuRes = await tools.get_restaurant_menu({ restaurantId: restName });
    toolTrace.push({ name: "get_restaurant_menu", status: "complete", count: menuRes.count });

    if (menuRes.count > 0) {
      replyText = `🏪 **${menuRes.restaurantName} Menu Highlights** (${menuRes.count} items available):\n\n` +
        menuRes.items.slice(0, 6).map(item => `- **${item.name}** (${item.isVegetarian ? '🟢 Veg' : '🔴 Non-veg'}, ${item.category}) — **₹${item.priceRupees}** (${item.prepMinutes}m prep)`).join("\n") +
        `\n\n*Would you like me to recommend or prepare an order for one of these dishes?*`;
      return { reply: replyText, model: "Offline Intent Agent (Rule Engine)", toolCalls: toolTrace, recommendedCards: cards };
    }
  }

  // Intent H: Direct Named Dish Order ("Order the Margherita")
  const hasConstraints = /(?:under|below|less than|budget|within|in \d+ mins)/i.test(low);
  const orderMatch = low.match(/(?:order|buy|get me|checkout|proceed with)\s+(?:the\s+)?(.+)/i);
  if (orderMatch && !hasConstraints && !contextual.isOrderReference) {
    const dishQuery = orderMatch[1].replace(/for me|please/gi, "").trim();
    const ticketRes = await tools.prepare_order_checkout({ dishName: dishQuery, profileKey });
    if (ticketRes.checkoutTicket) {
      toolTrace.push({ name: "prepare_order_checkout", status: "complete", ticket: true });
      const t = ticketRes.checkoutTicket;
      checkoutTicket = t;
      await memoryService.updateSessionContext(session.sessionId, profileKey, {
        lastCheckoutTicket: checkoutTicket
      });
      replyText = `📋 **Order Ticket Prepared for ${t.name}!**\n\n- **Restaurant**: ${t.restaurantName} (★ ${t.restaurantRating})\n- **Food Price**: ₹${t.unitPriceRupees}\n- **Delivery Fee**: ₹${t.deliveryFeeRupees}\n- **Assumed 5% Food Tax**: ₹${t.taxRupees}\n- **Total Payable**: **₹${t.totalRupees}**\n- **Estimated Delivery**: ${t.estimatedMinutes} minutes\n\nClick **'Confirm & Place Order'** on the ticket below or reply **'Confirm'** to place this simulated demo order!`;
      cards = [t];
      return { reply: replyText, model: "Offline Intent Agent (Rule Engine)", toolCalls: toolTrace, recommendedCards: cards, checkoutTicket };
    }
  }

  // Intent I: Food Discovery & Multi-Agent Constraint Solving
  const budgetRupees = contextual.budgetRupees;
  const deadlineMinutes = contextual.deadlineMinutes;
  const isVeg = contextual.vegetarian;
  const category = contextual.category;
  const isComboQuery = /combo|with drink|with side|add fries|garlic bread|dessert|shake/i.test(message);

  const bestOptions = await tools.find_best_food_options({
    budgetRupees,
    deadlineMinutes,
    vegetarian: isVeg,
    category,
    cuisine: contextual.cuisine
  });

  toolTrace.push(
    { name: "resolveContextualQuery", status: "complete", result: { category, budgetRupees, deadlineMinutes, isVeg } },
    { name: "find_best_food_options", status: "complete", resultCount: bestOptions.count }
  );

  let combos = null;
  if (bestOptions.count > 0) {
    const top = bestOptions.topMatches[0];
    let cardsToShow = [];

    if (budgetRupees >= 800 && bestOptions.count >= 6) {
      // Pick a balanced spectrum across price bands: Budget (<=350), Mid (351-550), and Premium/Gourmet (>550)
      const budgetBand = bestOptions.allMatches.filter(c => Number(c.priceRupees) <= 350);
      const midBand = bestOptions.allMatches.filter(c => Number(c.priceRupees) > 350 && Number(c.priceRupees) <= 550);
      const premiumBand = bestOptions.allMatches.filter(c => Number(c.priceRupees) > 550);

      const picked = [
        ...budgetBand.slice(0, 2),
        ...midBand.slice(0, 2),
        ...premiumBand.slice(0, 2)
      ];

      // If any band was short, fill up to 6 from top matches
      const seen = new Set(picked.map(p => p.id));
      for (const m of bestOptions.topMatches) {
        if (picked.length >= 6) break;
        if (!seen.has(m.id)) {
          picked.push(m);
          seen.add(m.id);
        }
      }
      cardsToShow = picked.sort((a, b) => a.totalPaise - b.totalPaise);
    } else {
      cardsToShow = bestOptions.topMatches.slice(0, budgetRupees >= 800 ? 6 : (bestOptions.count >= 5 ? 5 : 3));
    }

    cards = cardsToShow;

    // Update STM with candidate dishes for follow-up turns
    await memoryService.updateSessionContext(session.sessionId, profileKey, {
      activeCategory: category,
      activeBudgetRupees: budgetRupees,
      activeDeadlineMinutes: deadlineMinutes,
      activeDiet: isVeg,
      lastMentionedDishes: cards
    });

    const isHighBudget = budgetRupees >= 800;
    const tierNote = isHighBudget
      ? `\n\n✨ **Broad Budget Range (up to ₹${budgetRupees})**: Showing a curated spectrum spanning Budget Classics (₹199–₹349), Loaded Signatures (₹359–₹549), and Artisanal Burrata/Truffle & Sourdough Crusts (₹579–₹749).`
      : "";

    replyText = `🎯 **I found ${bestOptions.count} eligible ${isVeg ? "vegetarian" : "non-vegetarian"} ${category} option(s)** under ₹${budgetRupees} delivered within ${deadlineMinutes} minutes.${tierNote}\n\n### 🏆 #1 Recommendation: **${top.name}**\n- **Restaurant**: ${top.restaurantName} (★ ${top.restaurantRating})\n- **Transparent Bill**: Food: ₹${top.priceRupees} + Delivery: ₹${top.deliveryFeeRupees} + 5% Tax: ₹${top.taxRupees} = **₹${top.totalRupees} Total**\n- **ETA**: **${top.estimatedMinutes} mins** (${top.description})\n- **Multi-Factor Score**: **${top.score}/100** (40% price headroom + 35% time headroom + 25% rating)`;

    if (isComboQuery || Number(top.totalRupees) < budgetRupees - 60) {
      combos = await tools.suggest_combos({
        baseItemId: top.id,
        budgetRupees,
        vegetarian: isVeg
      });
      toolTrace.push({ name: "suggest_combos", status: "complete", resultCount: combos.compatibleAddons?.length || 0 });

      if (combos.compatibleAddons && combos.compatibleAddons.length > 0) {
        replyText += `\n\n💡 **Smart Combo Opportunity**: You have **₹${combos.remainingHeadroomRupees} remaining headroom**! Consider bundling:`;
        combos.compatibleAddons.slice(0, 2).forEach(a => {
          replyText += `\n- **${a.name}** (+₹${a.priceRupees}) ➔ Combo Total: **₹${a.comboTotalRupees}**`;
        });
      }
    }

    replyText += "\n\n*Review the dish cards below, reply 'Order the first one', or click 'Review Order' to proceed!*";
  } else {
    replyText = `❌ **No menu item met every hard constraint.**\n\n- **Requested Diet**: ${isVeg ? "Vegetarian Only" : "Non-Vegetarian"}\n- **Max Budget**: ₹${budgetRupees}\n- **Max Time**: ${deadlineMinutes} minutes\n\n*The agents strictly enforce your constraints and will not silently exceed your budget. Try adjusting your budget (e.g. ₹550) or deadline (35 mins)!*`;
  }

  return {
    reply: replyText,
    model: "Offline Multi-Agent Coordinator (Deterministic Engine)",
    toolCalls: toolTrace,
    recommendedCards: cards,
    comboData: combos
  };
}

// ============================================================================
// Live Google Gemini LLM Agent with Dynamic Model Selection & Memory
// ============================================================================
async function callGeminiAgent({ apiKey, model = "gemini-2.5-flash", message, history = [], profileKey, session }) {
  const chosenModel = String(model || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${chosenModel}:generateContent?key=${apiKey}`;

  // Step 1: Extract any new semantic memory facts
  const discoveredFacts = memoryService.extractFactsFromText(message);
  for (const f of discoveredFacts) {
    await memoryService.saveMemoryFact(profileKey, f.category, f.key, f.value, "gemini_chat_extractor");
  }

  // Step 2: Build enriched system prompt with LTM + STM
  const memoryPrompt = await memoryService.formatMemoryPrompt(profileKey, session.context);

  const systemInstruction = {
    parts: [{
      text: `You are FoodieAgent, an intelligent, transparent, and empathetic AI food ordering concierge and multi-agent coordinator for a college project demo.
Your core mission is to provide end-to-end assistance on all food ordering queries:
1. Strict Constraint Enforcement: Always respect user budget (₹), delivery time (minutes), and dietary preferences (vegetarian vs non-vegetarian).
2. Callable Tools: Always call your provided tools to look up real catalogue prices, restaurants, menus, dishes, and combos. NEVER invent prices, restaurants, or dishes that don't exist.
3. Transparent Math: Food bill is ALWAYS: (UnitPrice × Qty) + DeliveryFee + (5% Tax on Food). Explain this breakdown clearly in rupees (₹).
4. Order Flow: Guide the user to review and confirm orders. When ready to order, invoke prepare_order_checkout or tell the user to click the review button.
5. End-to-End Capabilities: You can answer menu inquiries, compare dishes, suggest combos, track existing orders (track_user_orders), and inspect/update user preferences and memory.
6. Memory Awareness: You are equipped with a Dual-Tier Memory System (Short-Term Working Memory for active dialogue and Long-Term Episodic Memory for dietary habits/allergies/budgets). Always leverage memory context when available.${memoryPrompt}
Always respond with professional, polished Markdown, tables, and emoji bullet points.`
    }]
  };

  const contents = [
    ...history.slice(-8).map(h => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.text || h.content || "" }]
    })),
    {
      role: "user",
      parts: [{ text: message }]
    }
  ];

  const payload = {
    system_instruction: systemInstruction,
    contents,
    tools: [{ function_declarations: geminiFunctionDeclarations }],
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 1000
    }
  };

  const toolExecutions = [];
  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status} using ${chosenModel}): ${errText}`);
  }

  let data = await response.json();
  let candidate = data.candidates?.[0];
  let functionCall = candidate?.content?.parts?.find(p => p.functionCall)?.functionCall;

  let loopCount = 0;
  let recommendedCards = [];
  let checkoutTicket = null;

  while (functionCall && loopCount < 4) {
    loopCount++;
    const fnName = functionCall.name;
    const fnArgs = functionCall.args || {};
    fnArgs.profileKey = profileKey;

    let fnResult = {};
    if (tools[fnName]) {
      try {
        fnResult = await tools[fnName](fnArgs);
        toolExecutions.push({ name: fnName, args: fnArgs, result: fnResult });
        if (fnResult.topMatches) {
          recommendedCards = fnResult.topMatches;
          // Update STM with candidate dishes
          await memoryService.updateSessionContext(session.sessionId, profileKey, {
            lastMentionedDishes: recommendedCards
          });
        }
        if (fnResult.checkoutTicket) {
          checkoutTicket = fnResult.checkoutTicket;
          await memoryService.updateSessionContext(session.sessionId, profileKey, {
            lastCheckoutTicket: checkoutTicket
          });
        }
        if (fnResult.found && fnResult.id) recommendedCards = [fnResult];
      } catch (err) {
        fnResult = { error: err.message };
      }
    } else {
      fnResult = { error: `Tool ${fnName} not recognized` };
    }

    contents.push({ role: "model", parts: [{ functionCall }] });
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name: fnName, response: fnResult } }]
    });

    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: systemInstruction,
        contents,
        generationConfig: { temperature: 0.25, maxOutputTokens: 1000 }
      })
    });

    data = await response.json();
    candidate = data.candidates?.[0];
    functionCall = candidate?.content?.parts?.find(p => p.functionCall)?.functionCall;
  }

  const finalReply = candidate?.content?.parts?.find(p => p.text)?.text || "I found the required food and order information. Check the recommendations below!";

  return {
    reply: finalReply,
    model: `Google ${chosenModel}`,
    toolCalls: toolExecutions,
    recommendedCards,
    checkoutTicket
  };
}

// ============================================================================
// Main HTTP Handler
// ============================================================================
export default async function handler(req, res) {
  const b = req.body || {};
  const profileKey = safeProfileKey(b.profileKey);
  if (!profileKey) {
    return res.status(400).json({ error: "A valid browser demo profile is required." });
  }

  const message = String(b.message || "").trim();
  if (!message) {
    return res.status(400).json({ error: "Please provide a chat message." });
  }

  // Session & Working Memory Initialization
  const session = await memoryService.getOrCreateSession(profileKey, b.sessionId);
  const history = Array.isArray(b.history) ? b.history : [];
  const clientApiKey = String(b.geminiApiKey || req.headers["x-gemini-key"] || "").trim();
  const apiKey = clientApiKey || process.env.GEMINI_API_KEY || "";
  const requestedModel = b.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";

  // Enterprise Guardrail Check (Prompt Injection & Safety)
  const guard = guardrails.validateUserInput(message);
  if (!guard.safe) {
    return res.json({
      ok: true,
      sessionId: session.sessionId,
      reply: guard.safeResponse,
      model: "FoodieAgent Guardrails Engine",
      guardrailTriggered: true,
      toolCalls: [{ name: "guardrails.validateUserInput", status: "intercepted", reason: guard.reason }],
      recommendedCards: [],
      timestamp: new Date().toISOString()
    });
  }

  try {
    // Record user message in STM
    await memoryService.addChatMessage(session.sessionId, profileKey, "user", message);

    let result;
    if (apiKey) {
      try {
        result = await callGeminiAgent({ apiKey, model: requestedModel, message, history, profileKey, session });
      } catch (geminiError) {
        console.warn("Gemini call failed, falling back to offline deterministic agent:", geminiError.message);
        result = await offlineAgent({ message, profileKey, session });
        result.warning = `Gemini API fallback (${geminiError.message}). Operating in offline deterministic mode.`;
      }
    } else {
      result = await offlineAgent({ message, profileKey, session });
    }

    // Record model response in STM
    await memoryService.addChatMessage(session.sessionId, profileKey, "model", result.reply, {
      model: result.model,
      toolCallsCount: result.toolCalls?.length || 0,
      cardsCount: result.recommendedCards?.length || 0,
      hasTicket: Boolean(result.checkoutTicket)
    });

    // Persist agent run audit log
    await db.query(
      "INSERT INTO fa_agent_runs (profile_key, request_text, request_json, result_json) VALUES ($1, $2, $3, $4)",
      [
        profileKey,
        `[Chat] ${message.slice(0, 150)}`,
        JSON.stringify({ message, historyLength: history.length, model: result.model, sessionId: session.sessionId }),
        JSON.stringify(result)
      ]
    );

    return res.json({
      ok: true,
      sessionId: session.sessionId,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Failed to process chat message." });
  }
}
