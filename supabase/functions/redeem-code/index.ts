import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Please sign in and try again." }, 401);

    const { code, nickname, username, email } = await req.json();
    if (typeof code !== "string" || typeof nickname !== "string" || !nickname.trim()) return json({ error: "Code and display name are required." }, 400);

    const cleanUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) return json({ error: "Username must be 3–24 characters using letters, numbers, or underscore." }, 400);

    // Validate details and username availability BEFORE consuming the one-time code.
    const { data: existingUsername, error: usernameErr } = await admin.from("room_members").select("user_id").eq("username", cleanUsername).maybeSingle();
    if (usernameErr) throw usernameErr;
    if (existingUsername && existingUsername.user_id !== user.id) return json({ error: "That username is already taken." }, 409);
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (cleanEmail.length > 254 || !emailRe.test(cleanEmail)) return json({ error: "Enter a valid email address." }, 400);

    const normalized = code.trim().toUpperCase();
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    const hash = [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");

    // Atomic single-use redemption: only one request can update an unused matching code.
    const { data: rows, error: redeemErr } = await admin.from("activation_codes")
      .update({ used_at: new Date().toISOString(), used_by: user.id })
      .eq("code_hash", hash).is("used_at", null).select("id");
    if (redeemErr) throw redeemErr;
    if (!rows?.length) return json({ error: "Invalid, expired, or already-used activation code." }, 403);

    const { error: memberErr } = await admin.from("room_members").upsert({
      user_id: user.id, nickname: nickname.trim().slice(0, 28), username: cleanUsername, email: cleanEmail, last_seen: new Date().toISOString()
    });
    if (memberErr) throw memberErr;
    return json({ success: true });
  } catch (e) { return json({ error: e.message || "Unexpected server error." }, 500); }
});
