import { db } from "../lib/db.js";
import { safeProfileKey } from "../lib/foodie.js";
export const access = "public";
export const methods = ["POST"];
export default async function(req,res){
  const key=safeProfileKey(req.body?.profileKey);
  if(!key)return res.status(400).json({error:"A valid browser demo profile is required."});
  await db.query("DELETE FROM fa_notifications WHERE profile_key=$1",[key]);
  await db.query("DELETE FROM fa_agent_runs WHERE profile_key=$1",[key]);
  await db.query("DELETE FROM fa_orders WHERE profile_key=$1",[key]);
  await db.query("DELETE FROM fa_preferences WHERE profile_key=$1",[key]);
  return res.json({ok:true,message:"Browser demo profile data reset. Shared mock catalogue was preserved."});
}