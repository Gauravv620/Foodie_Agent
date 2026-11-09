import { db } from "../lib/db.js";
import { safeProfileKey, create_order, get_order_status } from "../lib/foodie.js";
export const access = "public";
export const methods = ["GET","POST"];
export default async function(req,res){
  if(req.method==="GET"){
    const key=safeProfileKey(req.query?.profileKey);
    if(!key)return res.status(400).json({error:"A valid browser demo profile is required."});
    const {rows}=await db.query("SELECT o.*,r.name AS restaurant_name,r.image_url AS restaurant_image,m.name AS item_name,m.image_url AS item_image,m.is_vegetarian FROM fa_orders o JOIN fa_restaurants r ON r.id=o.restaurant_id JOIN fa_menu_items m ON m.id=o.menu_item_id WHERE o.profile_key=$1 ORDER BY o.created_at DESC LIMIT 50",[key]);
    return res.json({orders:rows});
  }
  const b=req.body||{};
  if(b.confirmed!==true)return res.status(400).json({error:"Please explicitly confirm the order before placing it."});
  try{
    const order=await create_order({
      profileKey:b.profileKey,restaurantId:b.restaurantId,menuItemId:b.menuItemId,
      quantity:b.quantity,confirmed:b.confirmed,idempotencyKey:b.idempotencyKey,
      budgetPaise:b.budgetPaise,deadlineMinutes:b.deadlineMinutes,
      vegetarianRequired:b.vegetarianRequired!==false,nonVegetarianOnly:b.nonVegetarianOnly===true,category:b.category||"pizza"
    });
    return res.status(201).json({ok:true,order,simulationNotice:"Simulated order only. No real restaurant was contacted."});
  }catch(e){return res.status(400).json({error:e.message||"Could not create the demo order."});}
}