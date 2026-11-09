import { db } from "../lib/db.js";
import { safeProfileKey } from "../lib/foodie.js";
export const access = "public";
export const methods = ["GET"];
export default async function(req,res){
  const key = safeProfileKey(req.query?.profileKey);
  const [restaurants,menu] = await Promise.all([
    db.query("SELECT id,name,cuisine,description,rating,delivery_fee_paise,estimated_minutes,is_open,service_area,image_url FROM fa_restaurants ORDER BY rating DESC,name"),
    db.query("SELECT id,restaurant_id,name,description,category,is_vegetarian,price_paise,prep_minutes,image_url,is_available,tags FROM fa_menu_items ORDER BY restaurant_id,category,price_paise")
  ]);
  let preferences = null, orders = [], notifications = [], agentRuns = [];
  if(key){
    const [p,o,n,a] = await Promise.all([
      db.query("SELECT * FROM fa_preferences WHERE profile_key=$1",[key]),
      db.query("SELECT o.*,r.name AS restaurant_name,m.name AS item_name FROM fa_orders o JOIN fa_restaurants r ON r.id=o.restaurant_id JOIN fa_menu_items m ON m.id=o.menu_item_id WHERE o.profile_key=$1 ORDER BY o.created_at DESC LIMIT 20",[key]),
      db.query("SELECT * FROM fa_notifications WHERE profile_key=$1 ORDER BY created_at DESC LIMIT 20",[key]),
      db.query("SELECT id,request_text,result_json,created_at FROM fa_agent_runs WHERE profile_key=$1 ORDER BY created_at DESC LIMIT 8",[key])
    ]);
    preferences = p.rows[0] || null; orders=o.rows; notifications=n.rows; agentRuns=a.rows;
  }
  res.json({
    app:"FoodieAgent",dataMode:"SIMULATED",
    taxAssumption:"5% tax on food subtotal; delivery fee is shown separately.",
    counts:{restaurants:restaurants.rows.length,menuItems:menu.rows.length,vegetarian:menu.rows.filter(x=>x.is_vegetarian).length},
    restaurants:restaurants.rows,menuItems:menu.rows,preferences,orders,notifications,agentRuns
  });
}