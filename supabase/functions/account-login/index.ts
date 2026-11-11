import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const { identifier, password } = await req.json();
    if (typeof identifier !== "string" || typeof password !== "string" || !password) return json({ error: "Enter your email or username and password." }, 400);
    const value = identifier.trim().toLowerCase();
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let query = admin.from("room_members").select("email,username,nickname").limit(1);
    query = emailRe.test(value) ? query.eq("email", value) : query.eq("username", value);
    const { data: member, error: lookupError } = await query.maybeSingle();
    if (lookupError) throw lookupError;
    if (!member?.email) return json({ error: "Login details not found. Check your email/username and password." }, 401);
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.signInWithPassword({ email: member.email, password });
    if (error || !data.session) return json({ error: "Login details not found. Check your email/username and password." }, 401);
    return json({ session: data.session, member: { username: member.username, nickname: member.nickname } });
  } catch (_error) {
    return json({ error: "Login could not be completed. Please try again." }, 500);
  }
});
