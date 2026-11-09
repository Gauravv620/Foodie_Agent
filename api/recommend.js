import { db } from "../lib/db.js";
import { safeProfileKey, parseFoodRequest, search_restaurants, get_restaurant_menu, filter_vegetarian_items, filter_non_vegetarian_items, calculate_total_price, check_delivery_estimate } from "../lib/foodie.js";
export const access = "public";
export const methods = ["POST"];
function score(total,budget,minutes,deadline,rating){
  const priceScore=Math.max(0,Math.min(100,Math.round(100*(1-total/Math.max(1,budget)))));
  const deliveryScore=Math.max(0,Math.min(100,Math.round(100*(1-minutes/Math.max(1,deadline)))));
  const ratingScore=Math.max(0,Math.min(100,Math.round(Number(rating)/5*100)));
  return {price:priceScore,delivery:deliveryScore,rating:ratingScore,total:Math.round(priceScore*.40+deliveryScore*.35+ratingScore*.25)};
}
export default async function(req,res){
  const b=req.body||{}, profileKey=safeProfileKey(b.profileKey);
  if(!profileKey)return res.status(400).json({error:"Reload the page so a local demo profile can be created."});
  const requestText=String(b.requestText||"").trim().slice(0,500);
  const savedResult=b.useSavedMemory===true?await db.query("SELECT * FROM fa_preferences WHERE profile_key=$1",[profileKey]):{rows:[]};
  const saved=savedResult.rows[0]||null;
  const explicit={};
  if(b.budgetRupees!==undefined&&b.budgetRupees!==null&&b.budgetRupees!=="")explicit.budgetPaise=Math.round(Number(b.budgetRupees)*100);
  if(typeof b.vegetarian==="boolean")explicit.vegetarian=b.vegetarian;
  if(b.deliveryLimitMinutes!==undefined&&b.deliveryLimitMinutes!==null&&b.deliveryLimitMinutes!=="")explicit.deadlineMinutes=Number(b.deliveryLimitMinutes);
  if(b.cuisine!==undefined)explicit.cuisine=String(b.cuisine||"").trim();
  if(b.preferredRestaurantId!==undefined)explicit.preferredRestaurantId=String(b.preferredRestaurantId||"");
  if(b.spiceLevel!==undefined)explicit.spiceLevel=String(b.spiceLevel||"");
  let requirements=parseFoodRequest(requestText,explicit);
  const memoryUsed=[];
  if(b.useSavedMemory===true&&saved){
    if(requirements.vegetarian==null&&saved.vegetarian!==null){requirements.vegetarian=saved.vegetarian;memoryUsed.push("vegetarian");}
    if(requirements.budgetPaise==null&&saved.budget_paise!==null){requirements.budgetPaise=Number(saved.budget_paise);memoryUsed.push("budget");}
    if(requirements.deadlineMinutes==null&&saved.delivery_limit_minutes!==null){requirements.deadlineMinutes=Number(saved.delivery_limit_minutes);memoryUsed.push("delivery limit");}
    if(!requirements.cuisine&&saved.cuisine){requirements.cuisine=saved.cuisine;memoryUsed.push("cuisine");}
    if(!requirements.preferredRestaurantId&&saved.preferred_restaurant_id){requirements.preferredRestaurantId=saved.preferred_restaurant_id;memoryUsed.push("preferred restaurant");}
    if(!requirements.spiceLevel&&saved.spice_level){requirements.spiceLevel=saved.spice_level;memoryUsed.push("spice level");}
  }
  if(requirements.budgetPaise==null)requirements.budgetPaise=50000;
  if(requirements.deadlineMinutes==null)requirements.deadlineMinutes=30;
  if(requirements.vegetarian==null&&!requirements.nonVegetarianOnly)requirements.vegetarian=true;
  if(!requirements.category)requirements.category="pizza";
  if(!Number.isSafeInteger(requirements.budgetPaise)||requirements.budgetPaise<100||requirements.budgetPaise>10000000)return res.status(400).json({error:"Budget must be between ₹1 and ₹100,000."});
  if(!Number.isInteger(requirements.deadlineMinutes)||requirements.deadlineMinutes<1||requirements.deadlineMinutes>180)return res.status(400).json({error:"Delivery time must be between 1 and 180 minutes."});
  const activities=[{agent:"Preference Agent",status:"complete",detail:"Parsed this request separately from long-term memory. Current explicit values win; saved values used only for missing fields: "+(memoryUsed.length?memoryUsed.join(", "):"none")+". The rule-based parser is deterministic and does not call an LLM."}];
  const restaurants=await search_restaurants({cuisine:requirements.cuisine,profileKey});
  activities.push({agent:"Restaurant Discovery Agent",status:"complete",detail:"Searched "+restaurants.length+" restaurants; open/closed state and service area are marked as simulated."});
  const menuGroups=await Promise.all(restaurants.map(async restaurant=>({restaurant,menu:await get_restaurant_menu(restaurant.id)})));
  activities.push({agent:"Menu & Dietary Agent",status:"complete",detail:"Retrieved menus for "+menuGroups.length+" restaurants and validated explicit vegetarian/non-vegetarian metadata against the requested dietary mode."});
  const candidates=[], rejected=[];
  for(const group of menuGroups){
    const r=group.restaurant;
    const categoryItems=group.menu.filter(m=>!requirements.category||m.category===requirements.category);
    const dietaryItems=requirements.nonVegetarianOnly?await filter_non_vegetarian_items(categoryItems):(requirements.vegetarian===true?await filter_vegetarian_items(categoryItems):categoryItems);
    const dietaryIds=new Set(dietaryItems.map(item=>item.id));
    for(const m of categoryItems){
      if(!dietaryIds.has(m.id)){
        rejected.push({itemId:m.id,itemName:m.name,restaurantName:r.name,reason:requirements.nonVegetarianOnly?"Rejected: this request requires non-vegetarian items only.":"Rejected: this request requires vegetarian items only."});
        continue;
      }
      if(!m.is_available){rejected.push({itemId:m.id,itemName:m.name,restaurantName:r.name,reason:"Item is unavailable in the demo catalogue."});continue;}
      const total=calculate_total_price({unitPricePaise:Number(m.price_paise),quantity:1,deliveryFeePaise:Number(r.delivery_fee_paise)});
      const eta=await check_delivery_estimate(r.id,m.id);
      const reasons=[];
      if(!r.is_open)reasons.push("Restaurant is closed");
      if(!eta.available)reasons.push("Not available");
      if(total.totalPaise>requirements.budgetPaise)reasons.push("Total exceeds budget");
      if(eta.minutes>requirements.deadlineMinutes)reasons.push("Delivery exceeds time limit");
      if(requirements.preferredRestaurantId&&r.id!==requirements.preferredRestaurantId)reasons.push("Not the preferred restaurant");
      const isEligible=Boolean(r.is_open&&eta.available&&total.totalPaise<=requirements.budgetPaise&&eta.minutes<=requirements.deadlineMinutes&&(!requirements.preferredRestaurantId||r.id===requirements.preferredRestaurantId));
      const factor=score(total.totalPaise,requirements.budgetPaise,eta.minutes,requirements.deadlineMinutes,Number(r.rating));
      candidates.push({id:m.id,restaurantId:r.id,restaurantName:r.name,restaurantRating:Number(r.rating),restaurantImage:r.image_url,serviceArea:r.service_area,restaurantOpen:Boolean(r.is_open),name:m.name,description:m.description,category:m.category,isVegetarian:Boolean(m.is_vegetarian),pricePaise:Number(m.price_paise),deliveryFeePaise:Number(r.delivery_fee_paise),taxPaise:total.taxPaise,totalPaise:total.totalPaise,estimatedMinutes:eta.minutes,prepMinutes:Number(m.prep_minutes),imageUrl:m.image_url,score:factor.total,scoreFactors:factor,eligible:isEligible,reasons:isEligible?["Passes dietary, availability, budget, and delivery constraints"]:reasons.length?reasons:["Does not meet current constraints"]});
    }
  }
  activities.push({agent:"Price & Delivery Agent",status:"complete",detail:"Calculated food total, delivery fee, 5% food tax, and estimated time for "+candidates.length+" dietary/category-matched options."});
  const eligible=candidates.filter(x=>x.eligible).sort((a,b)=>b.score-a.score||a.totalPaise-b.totalPaise);
  eligible.forEach((x,i)=>x.rank=i+1);
  activities.push({agent:"Coordinator Agent",status:"complete",detail:"Applied hard constraints first, ranked "+eligible.length+" eligible options with 40% price, 35% delivery-time, and 25% rating."});
  activities.push({agent:"Order Monitoring Agent",status:"waiting",detail:"Will monitor the database-backed order after explicit confirmation; status changes create persistent notifications."});
  const preferenceSummary={vegetarian:requirements.vegetarian,nonVegetarianOnly:Boolean(requirements.nonVegetarianOnly),budgetPaise:requirements.budgetPaise,deadlineMinutes:requirements.deadlineMinutes,category:requirements.category,cuisine:requirements.cuisine||"",preferredRestaurantId:requirements.preferredRestaurantId||"",spiceLevel:requirements.spiceLevel||""};
  const result={requirements:preferenceSummary,memory:{retrieved:Boolean(saved&&b.useSavedMemory===true),usedFields:memoryUsed,savedPreferences:saved,explicitRequestWins:true},activities,candidates:candidates.sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score),ranked:eligible,rejected,recommendation:eligible[0]||null,toolCalls:[{name:"search_restaurants",calls:1,resultCount:restaurants.length},{name:"get_restaurant_menu",calls:menuGroups.length,resultCount:menuGroups.reduce((n,g)=>n+g.menu.length,0)},{name:"filter_vegetarian_items",calls:requirements.vegetarian===true?menuGroups.length:0,resultCount:requirements.vegetarian===true?candidates.length:0},{name:"filter_non_vegetarian_items",calls:requirements.nonVegetarianOnly?menuGroups.length:0,resultCount:requirements.nonVegetarianOnly?candidates.length:0},{name:"calculate_total_price",calls:candidates.length,resultCount:candidates.length},{name:"check_delivery_estimate",calls:candidates.length,resultCount:candidates.length}],availableOrderTools:["create_order (explicit confirmation required)","get_order_status","send_notification"],scoring:{price:40,delivery:35,rating:25,formula:"40% price headroom + 35% delivery headroom + 25% restaurant rating; hard constraints applied first."},taxAssumption:"5% tax is calculated on food subtotal; delivery is shown as a separate fee.",dataMode:"SIMULATED"};
  await db.query("INSERT INTO fa_agent_runs(profile_key,request_text,request_json,result_json) VALUES($1,$2,$3::jsonb,$4::jsonb)",[profileKey,requestText||"Default vegetarian pizza request",JSON.stringify({requirements:preferenceSummary,useSavedMemory:Boolean(b.useSavedMemory)}),JSON.stringify(result)]);
  return res.json(result);
}