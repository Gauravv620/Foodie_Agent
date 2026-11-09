import { db } from "./db.js";

export const STATUS_LABELS = {
  CONFIRMED: "Confirmed",
  PREPARING: "Preparing",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled"
};
export const STATUS_NEXT = {
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: []
};
export const DEMO_TAX_BPS = 500; // 5% tax on food subtotal; delivery is separate.

export function safeProfileKey(value) {
  const v = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{12,100}$/.test(v) ? v : null;
}
export function parseFoodRequest(text, explicit = {}) {
  const q = String(text || "").trim();
  const low = q.toLowerCase();
  const budgetMatch = low.match(/(?:under|below|less than|budget(?: of)?|up to)\s*[₹rs.]*\s*(\d[\d,]*)/i);
  const timeMatch = low.match(/(?:within|in|under|before)\s*(\d+)\s*(?:minutes?|mins?)/i);
  const categoryRules = [
    [/\bpizzas?\b/, "pizza"],
    [/\b(?:burgers?|hamburgers?)\b/, "burger"],
    [/\bwraps?\b/, "wrap"],
    [/\brolls?\b/, "roll"],
    [/\bpastas?\b/, "pasta"],
    [/\bnoodles?\b/, "noodles"],
    [/\bsalads?\b/, "salad"],
    [/\bbowls?\b/, "bowl"],
    [/\bsandwich(?:es)?\b/, "sandwich"],
    [/\b(?:dessert|brownie|cake|cheesecake|ice cream|cupcake|mousse|tiramisu)\b/, "dessert"],
    [/\b(?:shake|milkshake)\b/, "shake"],
    [/\b(?:drink|juice|lemonade|lassi|tea|coffee|cappuccino)\b/, "drink"],
    [/\b(?:fries|wedges|garlic bread|naan|roti)\b/, "side"],
    [/\b(?:snack|samosa|dhokla|chaat)\b/, "snack"],
    [/\b(?:biryani|dal|tikka|indian meal|paneer butter masala|thali)\b/, "indian"]
  ];
  const parsedCategory = categoryRules.find(([pattern]) => pattern.test(low))?.[1] || "";
  const inferredNonVegetarianOnly =
    /\bnon[\s-]?(?:vegetarian|veg)\b/i.test(low) ||
    /\b(?:chicken|pepperoni|sausage|bacon|ham|salami|prawn|shrimp|fish)\s+(?:pizza|burger|wrap|roll|pasta|noodles?)\b/i.test(low) ||
    /\b(?:pizza|burger|wrap|roll|pasta|noodles?)\s+(?:with|topped with)\s+(?:chicken|pepperoni|sausage|bacon|ham|salami|prawn|shrimp|fish)\b/i.test(low);
  const nonVegetarianOnly = inferredNonVegetarianOnly || explicit.nonVegetarianOnly === true;
  const veg = nonVegetarianOnly ? false : (/\bvegetarian\b|\bveg\b|veggie/.test(low) ? true : null);
  return {
    query: q || "vegetarian pizza under ₹500 within 30 minutes",
    category: explicit.category || parsedCategory,
    nonVegetarianOnly,
    vegetarian: nonVegetarianOnly ? false : (explicit.vegetarian !== undefined ? explicit.vegetarian : veg),
    budgetPaise: explicit.budgetPaise != null ? Math.max(0, Math.round(Number(explicit.budgetPaise))) : budgetMatch ? Math.round(Number(budgetMatch[1].replace(/,/g, "")) * 100) : null,
    deadlineMinutes: explicit.deadlineMinutes != null ? Math.max(1, Math.min(180, Math.round(Number(explicit.deadlineMinutes)))) : timeMatch ? Math.max(1, Math.min(180, Number(timeMatch[1]))) : null,
    cuisine: explicit.cuisine || "",
    preferredRestaurantId: explicit.preferredRestaurantId || "",
    spiceLevel: explicit.spiceLevel || ""
  };
}
export async function search_restaurants({ cuisine = "", profileKey = null } = {}) {
  const sql = "SELECT id, name, cuisine, description, rating, delivery_fee_paise, estimated_minutes, is_open, service_area, image_url FROM fa_restaurants WHERE ($1 = '' OR lower(cuisine) LIKE lower($2)) ORDER BY is_open DESC, rating DESC, name";
  const { rows } = await db.query(sql, [String(cuisine || ""), "%" + String(cuisine || "") + "%"]);
  return rows;
}
export async function get_restaurant_menu(restaurantId) {
  if (!restaurantId) return [];
  const { rows } = await db.query("SELECT id, restaurant_id, name, description, category, is_vegetarian, price_paise, prep_minutes, image_url, is_available, tags FROM fa_menu_items WHERE restaurant_id = $1 ORDER BY category, price_paise, name", [String(restaurantId)]);
  return rows;
}
export async function filter_vegetarian_items(items) {
  return (items || []).filter(item => item && item.is_vegetarian === true);
}
export async function filter_non_vegetarian_items(items) {
  return (items || []).filter(item => item && item.is_vegetarian === false);
}
export function calculate_total_price({ unitPricePaise, quantity = 1, deliveryFeePaise = 0, taxBps = DEMO_TAX_BPS }) {
  const price = Math.round(Number(unitPricePaise));
  const qty = Math.round(Number(quantity));
  const delivery = Math.round(Number(deliveryFeePaise));
  if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(qty) || qty < 1 || qty > 10 || !Number.isSafeInteger(delivery) || delivery < 0) {
    throw new Error("Invalid price, delivery fee, or quantity.");
  }
  const subtotal = price * qty;
  const tax = Math.round(subtotal * Number(taxBps) / 10000);
  return { subtotalPaise: subtotal, deliveryFeePaise: delivery, taxPaise: tax, totalPaise: subtotal + delivery + tax, taxRateBps: Number(taxBps) };
}
export async function check_delivery_estimate(restaurantId, itemId) {
  const { rows } = await db.query("SELECT r.id AS restaurant_id, r.name AS restaurant_name, r.is_open, r.estimated_minutes, m.id AS item_id, m.prep_minutes, m.is_available FROM fa_restaurants r JOIN fa_menu_items m ON m.restaurant_id = r.id WHERE r.id = $1 AND m.id = $2", [String(restaurantId), String(itemId)]);
  if (!rows.length) return { available: false, minutes: null, reason: "Restaurant or menu item was not found." };
  const x = rows[0], minutes = Math.max(Number(x.estimated_minutes), Number(x.prep_minutes) + 8);
  return { available: Boolean(x.is_open && x.is_available), minutes, reason: !x.is_open ? "Restaurant is closed." : !x.is_available ? "Item is currently unavailable." : "Simulated estimate from prep + delivery window." };
}
export async function get_order_status({ orderId, profileKey }) {
  const key = safeProfileKey(profileKey);
  if (!key) throw new Error("A valid demo profile is required.");
  const { rows } = await db.query("SELECT o.*, r.name AS restaurant_name, m.name AS item_name FROM fa_orders o JOIN fa_restaurants r ON r.id=o.restaurant_id JOIN fa_menu_items m ON m.id=o.menu_item_id WHERE o.id=$1 AND o.profile_key=$2", [String(orderId), key]);
  return rows[0] || null;
}
export async function send_notification({ profileKey, orderId = null, title, message }) {
  const key = safeProfileKey(profileKey);
  if (!key) throw new Error("A valid demo profile is required.");
  const id = "ntf_" + crypto.randomUUID();
  const { rows } = await db.query("INSERT INTO fa_notifications (id,profile_key,order_id,title,message) VALUES ($1,$2,$3,$4,$5) RETURNING id, profile_key, order_id, title, message, is_read, created_at", [id, key, orderId, String(title).slice(0,120), String(message).slice(0,500)]);
  return rows[0];
}
export async function create_order({ profileKey, restaurantId, menuItemId, quantity = 1, confirmed = false, idempotencyKey, budgetPaise = 50000, deadlineMinutes = 30, vegetarianRequired = true, nonVegetarianOnly = false, category = "pizza" }) {
  const key = safeProfileKey(profileKey);
  if (!key) throw new Error("A valid demo profile is required.");
  if (confirmed !== true) throw new Error("Order requires explicit user confirmation.");
  const qty = Math.round(Number(quantity));
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 10) throw new Error("Quantity must be between 1 and 10.");
  const idem = String(idempotencyKey || "").trim();
  if (!/^[a-zA-Z0-9_-]{10,100}$/.test(idem)) throw new Error("A valid idempotency key is required.");
  const { rows: items } = await db.query("SELECT r.id AS restaurant_id,r.name AS restaurant_name,r.is_open,r.delivery_fee_paise,r.estimated_minutes,m.id AS menu_item_id,m.name AS item_name,m.category,m.is_vegetarian,m.price_paise,m.prep_minutes,m.is_available FROM fa_restaurants r JOIN fa_menu_items m ON m.restaurant_id=r.id WHERE r.id=$1 AND m.id=$2", [String(restaurantId), String(menuItemId)]);
  if (!items.length) throw new Error("Selected menu item could not be found.");
  const item = items[0];
  if (!item.is_open || !item.is_available) throw new Error("This restaurant or item is no longer available in the demo catalogue.");
  const estimate = await check_delivery_estimate(restaurantId, menuItemId);
  const total = calculate_total_price({ unitPricePaise: Number(item.price_paise) * qty, quantity: 1, deliveryFeePaise: Number(item.delivery_fee_paise) });
  if (category && item.category !== String(category)) throw new Error("This item does not match the selected food category.");
  if (vegetarianRequired === true && item.is_vegetarian !== true) throw new Error("This item is not explicitly classified as vegetarian.");
  if (nonVegetarianOnly === true && item.is_vegetarian !== false) throw new Error("This request requires a non-vegetarian item.");
  if (total.totalPaise > Number(budgetPaise)) throw new Error("The final total exceeds the current budget.");
  if (!estimate.available || estimate.minutes > Number(deadlineMinutes)) throw new Error("The simulated delivery estimate exceeds the deadline or is unavailable.");
  const existing = await db.query("SELECT id FROM fa_orders WHERE profile_key=$1 AND idempotency_key=$2", [key, idem]);
  if (existing.rows.length) return await get_order_status({ orderId: existing.rows[0].id, profileKey: key });
  const orderId = "FA-" + crypto.randomUUID().slice(0,8).toUpperCase();
  const { rows } = await db.query("INSERT INTO fa_orders (id,profile_key,restaurant_id,menu_item_id,quantity,item_price_paise,delivery_fee_paise,tax_paise,total_paise,estimated_minutes,status,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'CONFIRMED',$11) RETURNING *", [orderId, key, item.restaurant_id, item.menu_item_id, qty, total.subtotalPaise, total.deliveryFeePaise, total.taxPaise, total.totalPaise, estimate.minutes, idem]);
  await db.query("INSERT INTO fa_order_items (order_id,menu_item_id,item_name,quantity,unit_price_paise) VALUES ($1,$2,$3,$4,$5)", [orderId,item.menu_item_id,item.item_name,qty,Number(item.price_paise)]);
  await send_notification({ profileKey:key, orderId, title:"Order confirmed", message:orderId + " is confirmed. " + item.item_name + " from " + item.restaurant_name + "." });
  return { ...rows[0], restaurant_name:item.restaurant_name, item_name:item.item_name };
}