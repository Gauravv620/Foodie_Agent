import { db } from "../lib/db.js";
import { safeProfileKey } from "../lib/foodie.js";
export const access = "public";
export const methods = ["GET","POST"];
export default async function(req,res){
  const b=req.body||{}, key=safeProfileKey(req.method==="GET"?req.query?.profileKey:b.profileKey);
  if(!key)return res.status(400).json({error:"A valid browser demo profile is required."});
  if(req.method==="GET"){
    const {rows}=await db.query("SELECT * FROM fa_notifications WHERE profile_key=$1 ORDER BY created_at DESC LIMIT 50",[key]);
    return res.json({notifications:rows,unread:rows.filter(n=>!n.is_read).length});
  }
  const id=String(b.notificationId||"");
  if(id){
    const {rows}=await db.query("UPDATE fa_notifications SET is_read=TRUE WHERE id=$1 AND profile_key=$2 RETURNING *",[id,key]);
    return res.json({ok:true,notification:rows[0]||null});
  }
  await db.query("UPDATE fa_notifications SET is_read=TRUE WHERE profile_key=$1",[key]);
  return res.json({ok:true});
}