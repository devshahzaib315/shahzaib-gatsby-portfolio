import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Please sign in and try again." }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Server configuration is incomplete.");

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Please sign in and try again." }, 401);

    const body = await req.json();
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 28) : "";
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!code || !nickname) return json({ error: "Code and display name are required." }, 400);
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return json({ error: "Username must be 3–24 characters using letters, numbers, or underscores." }, 400);
    }
    if (email.length > 254 || !emailRe.test(email)) return json({ error: "Enter a valid email address." }, 400);

    const { data: existingUsername, error: usernameErr } = await admin
      .from("room_members").select("user_id").eq("username", username).maybeSingle();
    if (usernameErr) throw usernameErr;
    if (existingUsername && existingUsername.user_id !== user.id) {
      return json({ error: "That username is already taken." }, 409);
    }

    const { data: existingEmail, error: emailErr } = await admin
      .from("room_members").select("user_id").eq("email", email).maybeSingle();
    if (emailErr) throw emailErr;
    if (existingEmail && existingEmail.user_id !== user.id) {
      return json({ error: "That email address is already in use." }, 409);
    }

    if (typeof body.password !== "string" || body.password.length < 8) {
      return json({ error: "Password must be at least 8 characters long." }, 400);
    }

    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
    const hash = [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");

    const { data: availableCode, error: codeCheckErr } = await admin.from("activation_codes")
      .select("id").eq("code_hash", hash).is("used_at", null).maybeSingle();
    if (codeCheckErr) throw codeCheckErr;
    if (!availableCode) return json({ error: "Invalid, expired, or already-used activation code." }, 403);

    // If the member signed in with this existing email, keep that verified identity.
    // Only attach email/password when the current session is the new anonymous account.
    if ((user.email || "").trim().toLowerCase() !== email) {
      const { error: authUpdateErr } = await admin.auth.admin.updateUserById(user.id, {
        email,
        password: body.password,
        email_confirm: true
      });
      if (authUpdateErr) {
        const authStatus = (authUpdateErr as { status?: number }).status;
        const authMessage = authUpdateErr.message || "";
        if (authStatus === 500 || /already been registered|already exists|duplicate key/i.test(authMessage)) {
          return json({
            error: "An account with this email already exists. Sign in with its original password, then retry this activation code."
          }, 409);
        }
        throw authUpdateErr;
      }
    }

    const { data: rows, error: redeemErr } = await admin.from("activation_codes")
      .update({ used_at: new Date().toISOString(), used_by: user.id })
      .eq("code_hash", hash).is("used_at", null).select("id");
    if (redeemErr) throw redeemErr;
    if (!rows?.length) return json({ error: "Invalid, expired, or already-used activation code." }, 403);

    const { error: memberErr } = await admin.from("room_members").upsert({
      user_id: user.id,
      nickname,
      username,
      email,
      last_seen: new Date().toISOString()
    });
    if (memberErr) throw memberErr;

    return json({ success: true });
  } catch (error) {
    console.error("redeem-code failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "The activation code could not be redeemed. Please try again." }, 500);
  }
});