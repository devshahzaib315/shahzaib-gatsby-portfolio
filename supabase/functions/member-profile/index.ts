import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return json({ error: "Please sign in first." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: claimsData, error: claimsError } = await admin.auth.getClaims(token);
    const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : "";
    if (claimsError || !userId) return json({ error: "Your session could not be verified. Please sign in again." }, 401);

    const { data: member, error: memberError } = await admin
      .from("room_members").select("user_id,is_banned").eq("user_id", userId).maybeSingle();
    if (memberError) throw memberError;
    if (!member || member.is_banned) return json({ error: "Active room membership is required." }, 403);

    const body = await req.json();
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const displayName = typeof body.display_name === "string" ? body.display_name.trim().slice(0, 28) : "";
    const bio = typeof body.bio === "string" ? body.bio.trim().slice(0, 240) : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return json({ error: "Username must be 3–24 characters using letters, numbers, or underscores." }, 400);
    }
    if (!displayName) return json({ error: "Display name is required." }, 400);

    const avatarUrl = body.avatar_url === null ? null :
      typeof body.avatar_url === "string" ? body.avatar_url : undefined;
    if (avatarUrl !== undefined && avatarUrl !== null) {
      const expectedPrefix = `${url}/storage/v1/object/public/avatars/${userId}/avatar.jpg`;
      if (!avatarUrl.startsWith(expectedPrefix)) return json({ error: "Invalid profile photo URL." }, 400);
    }

    const showOnlineStatus = typeof body.show_online_status === "boolean" ? body.show_online_status : true;
    const profileVisibility = body.profile_visibility === "private" ? "private" : "members";
    const dataSaver = typeof body.data_saver === "boolean" ? body.data_saver : false;
    const autoplayMedia = typeof body.autoplay_media === "boolean" ? body.autoplay_media : true;
    const hideSensitiveContent = typeof body.hide_sensitive_content === "boolean" ? body.hide_sensitive_content : true;
    const pushNotifications = typeof body.push_notifications === "boolean" ? body.push_notifications : false;

    const memberUpdate: Record<string, unknown> = {
      username,
      nickname: displayName,
      last_seen: new Date().toISOString()
    };
    const { error: updateMemberError } = await admin.from("room_members").update(memberUpdate).eq("user_id", userId);
    if (updateMemberError) {
      if (updateMemberError.code === "23505") return json({ error: "That username is already taken." }, 409);
      throw updateMemberError;
    }

    const profileRow: Record<string, unknown> = {
      user_id: userId,
      username,
      display_name: displayName,
      bio,
      show_online_status: showOnlineStatus,
      profile_visibility: profileVisibility,
      data_saver: dataSaver,
      autoplay_media: autoplayMedia,
      hide_sensitive_content: hideSensitiveContent,
      push_notifications: pushNotifications,
      updated_at: new Date().toISOString()
    };
    if (avatarUrl !== undefined) profileRow.avatar_url = avatarUrl;

    const { data: saved, error: saveError } = await admin.from("member_profiles")
      .upsert(profileRow, { onConflict: "user_id" })
      .select("user_id,username,display_name,bio,avatar_url,show_online_status,profile_visibility,data_saver,autoplay_media,hide_sensitive_content,push_notifications,updated_at")
      .single();
    if (saveError) {
      if (saveError.code === "23505") return json({ error: "That username is already taken." }, 409);
      throw saveError;
    }
    return json({ success: true, profile: saved });
  } catch (error) {
    console.error("member-profile failed:", error instanceof Error ? error.message : "unknown error");
    return json({ error: "Profile could not be saved. Please try again." }, 500);
  }
});