import { db } from "../../lib/db.js";
import { safeProfileKey, STATUS_NEXT, STATUS_LABELS, get_order_status, send_notification } from "../../lib/foodie.js";
export const access = "public";
export const methods = ["GET","POST"];
export default async function(req,res){
  const key=safeProfileKey(req.method==="GET"?req.query?.profileKey:req.body?.profileKey);
  const id=String(req.params?.id||"").trim();
  if(!key||!/^FA-[A-F0-9-]{8,40}$/i.test(id))return res.status(400).json({error:"Valid order and demo profile are required."});
  if(req.method==="GET"){
    const order=await get_order_status({orderId:id,profileKey:key});
    if(!order)return res.status(404).json({error:"Order not found for this demo profile."});
    const [timeline,notifications]=await Promise.all([
      db.query("SELECT status,updated_at FROM fa_orders WHERE id=$1 AND profile_key=$2",[id,key]),
      db.query("SELECT * FROM fa_notifications WHERE profile_key=$1 AND order_id=$2 ORDER BY created_at ASC",[key,id])
    ]);
    return res.json({order,timeline:timeline.rows,notifications:notifications.rows,statusLabels:STATUS_LABELS,nextStatuses:STATUS_NEXT[order.status]||[]});
  }
  const order=await get_order_status({orderId:id,profileKey:key});
  if(!order)return res.status(404).json({error:"Order not found for this demo profile."});
  const next=String(req.body?.status||"").toUpperCase();
  const allowed=STATUS_NEXT[order.status]||[];
  if(!allowed.includes(next))return res.status(400).json({error:"Invalid status transition from "+order.status+" to "+next+".",allowedNextStatuses:allowed});
  const {rows}=await db.query("UPDATE fa_orders SET status=$1,updated_at=now() WHERE id=$2 AND profile_key=$3 RETURNING *",[next,id,key]);
  const labels={CONFIRMED:"Confirmed",PREPARING:"Preparing",OUT_FOR_DELIVERY:"Out for delivery",DELIVERED:"Delivered",CANCELLED:"Cancelled"};
  await send_notification({profileKey:key,orderId:id,title:"Order "+labels[next],message:order.item_name+" at "+order.restaurant_name+" is now "+labels[next].toLowerCase()+" (demo status)."});
  const updated=await get_order_status({orderId:id,profileKey:key});
  return res.json({ok:true,order:updated,allowedNextStatuses:STATUS_NEXT[next]||[],simulationNotice:"Status is simulated for the demonstration."});
}