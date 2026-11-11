import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const emailRe = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\\s+/i, "");
    if (!token) return json({ error: "Please sign in first." }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return json({ error: "Please sign in first." }, 401);

    const { username, email, password } = await req.json();
    const cleanUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) return json({ error: "Username must be 3–24 characters using letters, numbers, or underscores." }, 400);
    if (cleanEmail.length > 254 || !emailRe.test(cleanEmail)) return json({ error: "Enter a valid email address." }, 400);
    if (typeof password !== "string" || password.length < 8) return json({ error: "Password must be at least 8 characters long." }, 400);

    const { data: member, error: memberError } = await admin.from("room_members").select("user_id").eq("user_id", user.id).maybeSingle();
    if (memberError) throw memberError;
    if (!member) return json({ error: "Activate your room membership before setting up login." }, 403);

    const { data: usernameConflict, error: usernameError } = await admin.from("room_members").select("user_id").eq("username", cleanUsername).maybeSingle();
    if (usernameError) throw usernameError;
    if (usernameConflict && usernameConflict.user_id !== user.id) return json({ error: "That username is already taken." }, 409);

    const { data: emailConflict, error: emailError } = await admin.from("room_members").select("user_id").eq("email", cleanEmail).maybeSingle();
    if (emailError) throw emailError;
    if (emailConflict && emailConflict.user_id !== user.id) return json({ error: "That email address is already in use." }, 409);

    // Admin update bypasses the confirmation-email flow that caused Supabase's email rate limit.
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(user.id, {
      email: cleanEmail,
      password,
      email_confirm: true
    });
    if (authUpdateError) {
      if (/already been registered|already exists/i.test(authUpdateError.message)) return json({ error: "That email address is already in use." }, 409);
      throw authUpdateError;
    }

    const { error: updateError } = await admin.from("room_members").update({ username: cleanUsername, email: cleanEmail }).eq("user_id", user.id);
    if (updateError) {
      if (updateError.code === "23505") return json({ error: "That username or email is already in use." }, 409);
      throw updateError;
    }
    return json({ success: true });
  } catch (_error) {
    return json({ error: "Account details could not be saved. Please try again." }, 500);
  }
});
