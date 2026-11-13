import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
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
async function audit(db: any, action: string, targetUserId: string | null = null, targetNickname: string | null = null, details: Record<string, unknown> = {}) {
  const { error } = await db.from("admin_activity").insert({
    action, target_user_id: targetUserId, target_nickname: targetNickname,
    actor: "Owner", details
  });
  if (error) throw error;
}
async function getMembers(db: any) {
  const { data: members, error } = await db.from("room_members")
    .select("user_id,nickname,username,email,joined_at,last_seen,is_banned,banned_at,ban_reason")
    .order("joined_at", { ascending: true });
  if (error) throw error;
  const { data: messageOwners, error: messageError } = await db.from("messages").select("user_id");
  if (messageError) throw messageError;
  const counts = new Map<string, number>();
  for (const row of messageOwners || []) counts.set(row.user_id, (counts.get(row.user_id) || 0) + 1);
  return (members || []).map((member: any) => ({ ...member, message_count: counts.get(member.user_id) || 0 }));
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const body = await req.json();
    const { admin_password, action } = body;
    const secret = Deno.env.get("ADMIN_PASSWORD");
    if (!secret || typeof admin_password !== "string" || admin_password !== secret) {
      return json({ error: "Admin password incorrect." }, 403);
    }
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    if (action === "dashboard") {
      const [members, messagesResult, activityResult, codesResult] = await Promise.all([
        getMembers(db),
        db.from("messages").select("id,user_id,nickname,body,created_at").order("created_at", { ascending: false }).limit(80),
        db.from("admin_activity").select("id,action,target_user_id,target_nickname,actor,details,created_at").order("created_at", { ascending: false }).limit(80),
        db.from("activation_codes").select("code_hint,used_at,created_at").order("created_at", { ascending: false }).limit(50)
      ]);
      if (messagesResult.error) throw messagesResult.error;
      if (activityResult.error) throw activityResult.error;
      if (codesResult.error) throw codesResult.error;
      const now = Date.now();
      return json({
        stats: {
          total_members: members.length,
          banned_members: members.filter((m: any) => m.is_banned).length,
          active_24h: members.filter((m: any) => m.last_seen && now - new Date(m.last_seen).getTime() < 86400000).length,
          total_messages: (messagesResult.data || []).length
        },
        members,
        messages: messagesResult.data || [],
        activity: activityResult.data || [],
        codes: codesResult.data || []
      });
    }

    if (action === "create") {
      const code = randomCode();
      const { error } = await db.from("activation_codes").insert({
        code_hash: await hashCode(code), code_hint: code.slice(0, 9) + "••••"
      });
      if (error) throw error;
      await audit(db, "activation_code_created", null, null, { code_hint: code.slice(0, 9) + "••••" });
      return json({ code });
    }

    if (action === "list") {
      const { data, error } = await db.from("activation_codes")
        .select("code_hint,used_at,created_at").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return json({ codes: data || [] });
    }

    if (action === "members") {
      const members = await getMembers(db);
      return json({ count: members.length, members });
    }

    if (action === "activity") {
      const { data, error } = await db.from("admin_activity")
        .select("id,action,target_user_id,target_nickname,actor,details,created_at")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return json({ activity: data || [] });
    }

    if (action === "messages") {
      const { data, error } = await db.from("messages")
        .select("id,user_id,nickname,body,created_at")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return json({ messages: data || [] });
    }

    if (action === "delete-message") {
      const messageId = Number(body.message_id);
      if (!Number.isSafeInteger(messageId) || messageId <= 0) return json({ error: "Invalid message." }, 400);
      const { data: row, error: readError } = await db.from("messages")
        .select("id,user_id,nickname,body").eq("id", messageId).maybeSingle();
      if (readError) throw readError;
      if (!row) return json({ error: "Message not found." }, 404);
      const { error } = await db.from("messages").delete().eq("id", messageId);
      if (error) throw error;
      await audit(db, "message_deleted", row.user_id, row.nickname, {
        message_id: messageId, preview: String(row.body || "").slice(0, 160)
      });
      return json({ success: true, message_id: messageId });
    }

    if (action === "ban" || action === "unban") {
      const userId = body.user_id;
      if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Invalid user." }, 400);
      const { data: member, error: readError } = await db.from("room_members")
        .select("user_id,nickname,is_banned").eq("user_id", userId).maybeSingle();
      if (readError) throw readError;
      if (!member) return json({ error: "Member not found." }, 404);
      if (action === "ban" && body.actor_user_id === userId) return json({ error: "You cannot ban your own account." }, 400);
      const banned = action === "ban";
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 240) : "";
      const { error } = await db.from("room_members").update({
        is_banned: banned,
        banned_at: banned ? new Date().toISOString() : null,
        ban_reason: banned ? (reason || "No reason provided") : null
      }).eq("user_id", userId);
      if (error) throw error;
      await audit(db, banned ? "member_banned" : "member_unbanned", userId, member.nickname, {
        reason: banned ? (reason || "No reason provided") : null
      });
      return json({ success: true, is_banned: banned });
    }

    if (action === "remove") {
      const { user_id, delete_messages } = body;
      if (typeof user_id !== "string" || !/^[0-9a-f-]{36}$/i.test(user_id)) return json({ error: "Invalid user." }, 400);
      if (body.actor_user_id === user_id) return json({ error: "You cannot remove yourself." }, 400);
      const { data: member, error: memberReadError } = await db.from("room_members")
        .select("nickname").eq("user_id", user_id).maybeSingle();
      if (memberReadError) throw memberReadError;
      if (!member) return json({ error: "Member not found." }, 404);
      let deletedMessages = 0;
      if (delete_messages === true) {
        const { data: deleted, error: msgErr } = await db.from("messages").delete().eq("user_id", user_id).select("id");
        if (msgErr) throw msgErr;
        deletedMessages = deleted?.length || 0;
      }
      const { error } = await db.from("room_members").delete().eq("user_id", user_id);
      if (error) throw error;
      try { await db.storage.from("avatars").remove([`${user_id}/avatar.jpg`]); } catch (_e) { /* best effort */ }
      await audit(db, "member_removed", user_id, member.nickname, { deleted_messages: deletedMessages });
      return json({ success: true, deleted_messages: deletedMessages });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("admin-codes failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Admin request failed. Please try again." }, 500);
  }
});