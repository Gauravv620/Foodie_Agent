import { db } from "../lib/db.js";
import { safeProfileKey } from "../lib/foodie.js";
export const access = "public";
export const methods = ["GET","PUT","DELETE"];
export default async function(req,res){
  const key = safeProfileKey(req.method==="GET" ? req.query?.profileKey : req.body?.profileKey);
  if(!key) return res.status(400).json({error:"A valid browser demo profile is required."});
  if(req.method==="GET"){
    const {rows}=await db.query("SELECT * FROM fa_preferences WHERE profile_key=$1",[key]);
    return res.json({preferences:rows[0]||null});
  }
  if(req.method==="DELETE"){
    await db.query("DELETE FROM fa_preferences WHERE profile_key=$1",[key]);
    return res.json({ok:true,preferences:null});
  }
  const b=req.body||{};
  const vegetarian=typeof b.vegetarian==="boolean"?b.vegetarian:null;
  const cuisine=String(b.cuisine||"").trim().slice(0,80)||null;
  const budgetRupees=b.budgetRupees==null||b.budgetRupees===""?null:Number(b.budgetRupees);
  const deadline=b.deliveryLimitMinutes==null||b.deliveryLimitMinutes===""?null:Number(b.deliveryLimitMinutes);
  const spice=["mild","medium","hot"].includes(b.spiceLevel)?b.spiceLevel:null;
  if(budgetRupees!==null&&(!Number.isFinite(budgetRupees)||budgetRupees<1||budgetRupees>100000))return res.status(400).json({error:"Budget must be between ₹1 and ₹100,000."});
  if(deadline!==null&&(!Number.isInteger(deadline)||deadline<1||deadline>180))return res.status(400).json({error:"Delivery limit must be between 1 and 180 minutes."});
  const preferred=String(b.preferredRestaurantId||"").trim()||null;
  if(preferred){
    const r=await db.query("SELECT id FROM fa_restaurants WHERE id=$1",[preferred]);
    if(!r.rows.length)return res.status(400).json({error:"Choose a restaurant from the catalogue."});
  }
  const {rows}=await db.query(
    "INSERT INTO fa_preferences(profile_key,vegetarian,cuisine,budget_paise,delivery_limit_minutes,preferred_restaurant_id,spice_level,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(profile_key) DO UPDATE SET vegetarian=EXCLUDED.vegetarian,cuisine=EXCLUDED.cuisine,budget_paise=EXCLUDED.budget_paise,delivery_limit_minutes=EXCLUDED.delivery_limit_minutes,preferred_restaurant_id=EXCLUDED.preferred_restaurant_id,spice_level=EXCLUDED.spice_level,updated_at=now() RETURNING *",
    [key,vegetarian,cuisine,budgetRupees===null?null:Math.round(budgetRupees*100),deadline,preferred,spice]
  );
  return res.json({ok:true,preferences:rows[0]});
}