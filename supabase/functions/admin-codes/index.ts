import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map(b => alphabet[b % alphabet.length]);
  return `SHAH-${chars.slice(0,4).join("")}-${chars.slice(4).join("")}`;
}
async function hashCode(code: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const { admin_password, action } = body;
    const secret = Deno.env.get("ADMIN_PASSWORD");
    if (!secret || typeof admin_password !== "string" || admin_password !== secret) return json({ error: "Admin password incorrect." }, 403);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "create") {
      const code = randomCode();
      const { error } = await db.from("activation_codes").insert({ code_hash: await hashCode(code), code_hint: code.slice(0, 9) + "••••" });
      if (error) throw error;
      return json({ code });
    }
    if (action === "list") {
      const { data, error } = await db.from("activation_codes").select("code_hint,used_at,created_at").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return json({ codes: data || [] });
    }
    if (action === "members") {
      const { data, error } = await db.from("room_members").select("user_id,nickname,email,joined_at,last_seen").order("joined_at", { ascending: true });
      if (error) throw error;
      return json({ count: (data || []).length, members: data || [] });
    }
    if (action === "remove") {
      const { user_id, delete_messages } = body;
      if (typeof user_id !== "string" || !/^[0-9a-f-]{36}$/i.test(user_id)) return json({ error: "Invalid user." }, 400);
      // Removing the membership row instantly cuts off reading and sending (RLS checks is_room_member()).
      const { error } = await db.from("room_members").delete().eq("user_id", user_id);
      if (error) throw error;
      if (delete_messages === true) {
        const { error: msgErr } = await db.from("messages").delete().eq("user_id", user_id);
        if (msgErr) throw msgErr;
      }
      try { await db.storage.from("avatars").remove([`${user_id}/avatar.jpg`]); } catch (_e) { /* best effort */ }
      return json({ success: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) { return json({ error: e.message || "Unexpected server error." }, 500); }
});
