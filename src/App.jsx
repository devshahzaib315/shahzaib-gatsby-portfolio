import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, configured } from './supabase';
import { ShieldCheck, LockKeyhole, MessageCircle, Users, Send, Copy, Plus, LogOut, KeyRound, Smile, Download, Sparkles, Mail, Camera, Trash2, UserMinus, ChevronDown, LayoutDashboard, MessageSquare, Activity, Search as SearchIcon, RefreshCw, Ban as BanIcon, CheckCircle2, Clock3 } from 'lucide-react';

const BASE = import.meta.env.VITE_SUPABASE_URL;
const FN = `${BASE}/functions/v1`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const AVATAR_URL = uid => `${BASE}/storage/v1/object/public/avatars/${uid}/avatar.jpg`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------- iOS-style emoji ----------
   iPhone / iPad / Mac already draw real Apple emoji. Everywhere else we swap emoji for Apple-style
   images and quietly fall back to the device's own emoji if an image fails to load. */
const IS_APPLE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent);
const EMOJI_RE = /(\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)/gu;
const EMOJIS = '😀 😁 😂 🤣 😊 😍 😘 😎 🤩 🥳 😇 🙂 😉 😋 😜 🤔 🤗 😴 😢 😭 😡 🥺 😱 🤯 🙄 😬 😅 🙏 👍 👎 👏 🙌 🤝 💪 👀 🔥 ✨ ⭐ 🌟 💯 🎉 🎁 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 🎵 ☕ 🍕 🍔 🍟 🍫 🎂 🌹 🌸 🌙 ☀️ ⚡ 🚀 🏆 ⚽ 🎮 📱 💻 📷 🔒 ✅ ❌ ⚠️'.split(' ');

// The Apple-style emoji images are bundled with this site (/emoji/*.webp): fast, cached, and no third-party CDN.
const hex = c => c.codePointAt(0).toString(16).padStart(4, '0');
function emojiFiles(char) {
  const cps = Array.from(char).map(hex);
  const bare = cps.filter(c => c !== 'fe0f');
  return [...new Set([cps.join('-'), bare.join('-'), [bare[0], 'fe0f', ...bare.slice(1)].join('-'), `${bare.join('-')}-fe0f`])];
}
function Emoji({ char }) {
  const [step, setStep] = useState(0);
  const files = useMemo(() => emojiFiles(char), [char]);
  if (IS_APPLE || step >= files.length) return <span className="emoji-native">{char}</span>;
  return <img className="emoji" src={`/emoji/${files[step]}.webp`} alt={char} draggable="false" loading="lazy" decoding="async" onError={() => setStep(s => s + 1)} />;
}
function EmojiText({ text }) {
  return <>{text.split(EMOJI_RE).map((part, i) => (i % 2 ? <Emoji key={i} char={part} /> : part))}</>;
}

/* ---------- @mentions ---------- */
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function RichText({ body, pattern, me }) {
  const segs = [];
  if (pattern) {
    const re = new RegExp(pattern, 'giu');
    let last = 0, m;
    while ((m = re.exec(body)) !== null) {
      if (m.index > last) segs.push({ type: 'text', value: body.slice(last, m.index) });
      segs.push({ type: 'mention', value: m[0], name: m[1] });
      last = m.index + m[0].length;
    }
    if (last < body.length) segs.push({ type: 'text', value: body.slice(last) });
  } else segs.push({ type: 'text', value: body });
  return <>{segs.map((s, i) => s.type === 'mention'
    ? <span key={i} className={`mention ${me && s.name.toLowerCase() === me.toLowerCase() ? 'me' : ''}`}>{s.value}</span>
    : <EmojiText key={i} text={s.value} />)}</>;
}

/* ---------- profile photo (DP) ---------- */
function Avatar({ name, url, cls = '' }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [url]);
  if (url && !bad) return <img className={`avatar ${cls}`} src={url} alt="" draggable="false" loading="lazy" decoding="async" onError={() => setBad(true)} />;
  return <span className={`avatar ${cls}`}>{(name || '?')[0]?.toUpperCase()}</span>;
}
// Centre-crop to a square and shrink to 256px JPEG so uploads stay tiny and fast.
async function squareJpeg(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not process the photo.'))), 'image/jpeg', 0.86));
}
// Day dividers show the real date, e.g. "10 Nov 2026".
function dayLabel(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const emojiOnly = body => body.replace(EMOJI_RE, '').trim() === '' && (body.match(EMOJI_RE) || []).length <= 3;
const timeOf = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Memoised: typing in the message box no longer re-renders (or re-parses) the whole conversation.
const MessageRow = memo(function MessageRow({ m, mine, grouped, newDay, label, dp, pattern, me }) {
  const mentioned = useMemo(() => !mine && !!me && new RegExp(`@${escapeRe(me)}(?![\\p{L}\\p{N}_])`, 'iu').test(m.body), [mine, me, m.body]);
  const big = useMemo(() => emojiOnly(m.body), [m.body]);
  return <>
    {newDay && <div className="day-sep"><span>{label}</span></div>}
    <div className={`message-row ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${mentioned ? 'mentioned' : ''}`}>
      <div className="avatar-slot">{!grouped && <Avatar name={m.nickname} url={dp}/>}</div>
      <div className="message-content">
        {!grouped && <div className="message-meta"><b>{mine ? 'You' : m.nickname}</b><time>{timeOf(m.created_at)}</time></div>}
        <div className={`bubble ${big ? 'big-emoji' : ''}`}><RichText body={m.body} pattern={pattern} me={me}/></div>
      </div>
    </div>
  </>;
});

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(() => { try { return JSON.parse(localStorage.getItem('sr-profile') || 'null'); } catch { return null; } });
  const [view, setView] = useState('gate');
  const [nickname, setNickname] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [loginMode, setLoginMode] = useState(false);
  const [accountUsername, setAccountUsername] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [code, setCode] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminData, setAdminData] = useState(null);
  const [adminTab, setAdminTab] = useState('dashboard');
  const [adminSearch, setAdminSearch] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [dpBusy, setDpBusy] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [codes, setCodes] = useState([]);
  const [owner, setOwner] = useState(null); // { count, members } — only filled after the admin password is verified
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const typingChannelRef = useRef(null);
  const typingTimerRef = useRef(null);
  const remoteTypingTimersRef = useRef({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [toast, setToast] = useState('');
  const [installEvt, setInstallEvt] = useState(null);
  const listRef = useRef(null);
  const bottom = useRef(null);
  const nearBottom = useRef(true);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
  const me = profile?.nickname || '';
  const myId = session?.user?.id;

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const h = e => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  useEffect(() => { if (profile && session) setView('chat'); }, [profile, session]);

  useEffect(() => {
    if (view !== 'chat' || !session) return;
    loadChat();
    const channel = supabase.channel('shahzaib-room-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        setMessages(prev => prev.some(m => m.id === payload.new.id) ? prev : [...prev, payload.new]);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.user_id === myId || !payload.user_id) return;
        const uid = payload.user_id;
        clearTimeout(remoteTypingTimersRef.current[uid]);
        if (!payload.typing) {
          setTypingUsers(prev => prev.filter(user => user.user_id !== uid));
          delete remoteTypingTimersRef.current[uid];
          return;
        }
        setTypingUsers(prev => [...prev.filter(user => user.user_id !== uid), { user_id: uid, nickname: payload.nickname || 'Someone' }]);
        remoteTypingTimersRef.current[uid] = setTimeout(() => {
          setTypingUsers(prev => prev.filter(user => user.user_id !== uid));
          delete remoteTypingTimersRef.current[uid];
        }, 2200);
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      typingChannelRef.current = null;
      Object.values(remoteTypingTimersRef.current).forEach(clearTimeout);
      remoteTypingTimersRef.current = {};
      setTypingUsers([]);
      supabase.removeChannel(channel);
    };
  }, [view, session]);

  // If the owner removes someone, their next check fails and they are sent back to the entry screen.
  useEffect(() => {
    if (view !== 'chat' || !session) return;
    let stop = false;
    const check = async () => {
      const { data, error: e } = await supabase.rpc('is_room_member');
      if (!stop && !e && data === false) { await leave(); setToast('You have been removed from the room.'); }
    };
    const first = setTimeout(check, 1500);
    const t = setInterval(check, 15000);
    return () => { stop = true; clearTimeout(first); clearInterval(t); };
  }, [view, session]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (nearBottom.current || last?.user_id === myId) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Phone keyboard fix: size the whole app to the VISIBLE area (above the keyboard) so the header and
  // the message box never slide off-screen or get cut when the keyboard opens.
  useEffect(() => {
    const vv = window.visualViewport; if (!vv) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
      root.style.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`);
      root.classList.toggle('kb-open', window.innerHeight - vv.height > 120);
      if (vv.offsetTop > 0) window.scrollTo(0, 0);
      const el = listRef.current;
      if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
    };
    apply();
    vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--app-h'); root.style.removeProperty('--app-top'); root.classList.remove('kb-open');
    };
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4200); return () => clearTimeout(t); }, [toast]);

  // Keep the owner dashboard fresh while its protected console is open.
  useEffect(() => {
    if (!adminOpen || !adminUnlocked || !adminPass) return;
    const t = setInterval(() => { loadAdminDashboard().catch(() => {}); }, 30000);
    return () => clearInterval(t);
  }, [adminOpen, adminUnlocked, adminPass]);

  function onScroll() {
    const el = listRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    nearBottom.current = near; setAtBottom(near);
  }
  async function loadChat() {
    const { data } = await supabase.from('messages').select('*').order('created_at').limit(200);
    setMessages(data || []);
    setTimeout(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, 50);
  }
  function saveProfile(p) { localStorage.setItem('sr-profile', JSON.stringify(p)); setProfile(p); }

  async function joinRoom(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (!configured) throw new Error('Please set up Supabase first. Follow the instructions in the README.');
      if (!nickname.trim() || !code.trim()) throw new Error('Enter your display name and activation code.');
      const cleanEmail = email.trim().toLowerCase();
      const cleanUsername = username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) throw new Error('Username must be 3–24 characters and contain only letters, numbers, or underscores.');
      if (!EMAIL_RE.test(cleanEmail)) throw new Error('Enter a valid email address.');
      if (password.length < 8) throw new Error('Password must be at least 8 characters long.');
      let current = session;
      const signedInEmail = (current?.user?.email || '').trim().toLowerCase();
      if (!current || current.user?.is_anonymous || signedInEmail !== cleanEmail) {
        // Reuse an existing account when the email was registered before.
        // This lets a returning member restore membership with a fresh invitation code.
        const { data: existingLogin, error: existingLoginError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password
        });
        if (!existingLoginError && existingLogin.session) {
          current = existingLogin.session;
        } else {
          const invalidCredentials = existingLoginError?.code === 'invalid_credentials'
            || /invalid login credentials/i.test(existingLoginError?.message || '');
          if (!invalidCredentials && existingLoginError) throw existingLoginError;
          if (!current || !current.user || !current.user.is_anonymous) {
            const { data, error: authError } = await supabase.auth.signInAnonymously();
            if (authError) throw authError;
            current = data.session;
          }
        }
      }
      if (!current?.access_token) throw new Error('Could not start your account session. Please try again.');
      const response = await fetch(`${FN}/redeem-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${current.access_token}` },
        body: JSON.stringify({ code: code.trim(), nickname: nickname.trim().slice(0, 28), username: cleanUsername, email: cleanEmail, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The activation code was not accepted.');
      saveProfile({ nickname: nickname.trim().slice(0, 28), username: cleanUsername, avatar: null });
      setView('chat'); setNotice('Welcome to Shahzaib Room.');
      setTimeout(() => setProfileOpen(true), 600);
    } catch (err) { setError(err.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  async function loginRoom(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (!configured) throw new Error('Please set up Supabase first. Follow the instructions in the README.');
      const response = await fetch(`${FN}/account-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
        body: JSON.stringify({ identifier: identifier.trim(), password })
      });
      const result = await response.json();
      if (!response.ok || !result.session) throw new Error(result.error || 'Login failed. Check your details.');
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: result.session.access_token, refresh_token: result.session.refresh_token
      });
      if (sessionError) throw sessionError;
      saveProfile({ nickname: result.member.nickname, username: result.member.username, avatar: null });
      setView('chat'); setNotice('Welcome back.');
    } catch (err) { setError(err.message || 'Login failed.'); }
    finally { setBusy(false); }
  }

  async function saveAccountCredentials(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const cleanEmail = accountEmail.trim().toLowerCase();
      const cleanUsername = accountUsername.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,24}$/.test(cleanUsername)) throw new Error('Username must be 3–24 characters and contain only letters, numbers, or underscores.');
      if (!EMAIL_RE.test(cleanEmail)) throw new Error('Enter a valid email address.');
      if (accountPassword.length < 8) throw new Error('Password must be at least 8 characters long.');
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch(`${FN}/account-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ username: cleanUsername, email: cleanEmail, password: accountPassword })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Account details could not be saved.');

      // Replace a stale anonymous session with a fresh email/password session.
      const { data: refreshedLogin, error: refreshedLoginError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: accountPassword
      });
      saveProfile({ ...profile, username: cleanUsername });
      setAccountPassword('');
      if (refreshedLoginError || !refreshedLogin.session) {
        setToast('Login details saved. Please log out and sign in again.');
      } else {
        setToast('Login details saved.');
      }
    } catch (err) { setError(err.message || 'Could not save login details.'); }
    finally { setBusy(false); }
  }

  function publishTyping(typing) {
    if (!session || !profile?.nickname) return;
    typingChannelRef.current?.send({
      type: 'broadcast', event: 'typing',
      payload: { user_id: session.user.id, nickname: profile.nickname, typing }
    });
  }
  function handleMessageChange(value) {
    setMessage(value);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (value.trim()) {
      publishTyping(true);
      typingTimerRef.current = setTimeout(() => publishTyping(false), 1800);
    } else publishTyping(false);
  }

  async function sendMessage(e) {
    e.preventDefault(); if (!message.trim() || !session) return;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    publishTyping(false);
    const body = message.trim().slice(0, 2000); setMessage(''); setPickerOpen(false);
    inputRef.current?.focus(); // keep the phone keyboard open after sending
    nearBottom.current = true;
    const { error: sendError } = await supabase.from('messages').insert({ user_id: session.user.id, nickname: profile.nickname, body, avatar_url: profile.avatar || null });
    if (sendError) { setToast(sendError.message); setMessage(body); }
  }

  async function changeDp(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !session) return;
    if (!file.type.startsWith('image/')) { setToast('Please choose an image file.'); return; }
    setDpBusy(true);
    try {
      const blob = await squareJpeg(file, 256);
      const path = `${session.user.id}/avatar.jpg`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
      if (upErr) throw upErr;
      saveProfile({ ...profile, avatar: `${AVATAR_URL(session.user.id)}?v=${Date.now()}` });
      setToast('Profile photo updated.');
    } catch (err) { setToast(err.message || 'Photo upload failed.'); }
    finally { setDpBusy(false); }
  }
  async function removeDp() {
    if (!session) return;
    setDpBusy(true);
    try { await supabase.storage.from('avatars').remove([`${session.user.id}/avatar.jpg`]); saveProfile({ ...profile, avatar: null }); setToast('Photo removed.'); }
    catch (err) { setToast(err.message || 'Could not remove the photo.'); }
    finally { setDpBusy(false); }
  }

  async function adminCall(action, extra = {}) {
    const current = (await supabase.auth.getSession()).data.session;
    const response = await fetch(`${FN}/admin-codes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${current?.access_token || ANON}` },
      body: JSON.stringify({ admin_password: adminPass, action, ...extra })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  async function loadAdminDashboard() {
    const data = await adminCall('dashboard');
    setAdminData(data);
    setOwner({ count: data.stats?.total_members || 0, members: data.members || [] });
    return data;
  }
  async function unlockAdmin() {
    setError(''); setNotice(''); setBusy(true);
    try {
      await loadAdminDashboard();
      setAdminUnlocked(true); setAdminTab('dashboard');
    } catch (err) { setError(err.message || 'Admin access could not be verified.'); }
    finally { setBusy(false); }
  }
  async function refreshAdmin() {
    try { await loadAdminDashboard(); setToast('Dashboard refreshed.'); }
    catch (err) { setError(err.message); }
  }
  async function makeCode() {
    setError(''); setNotice(''); setBusy(true);
    try {
      const data = await adminCall('create');
      setNewCode(data.code); setNotice('New one-time activation code generated.');
      await loadAdminDashboard();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function fetchCodes() {
    setError('');
    try {
      const data = await adminCall('list');
      setCodes(data.codes || []);
      setAdminData(prev => prev ? { ...prev, codes: data.codes || [] } : prev);
    } catch (err) { setError(err.message); }
  }
  async function fetchMembers() {
    setError('');
    try {
      const data = await adminCall('members');
      setOwner(data);
      setAdminData(prev => prev ? { ...prev, members: data.members || [], stats: { ...prev.stats, total_members: data.count } } : prev);
    } catch (err) { setError(err.message); }
  }
  async function toggleMemberBan(m) {
    if (m.user_id === myId) { setToast('You cannot ban your own account.'); return; }
    const action = m.is_banned ? 'unban' : 'ban';
    const reason = action === 'ban' ? (window.prompt('Reason for this ban (optional):') || '').trim() : '';
    if (action === 'ban' && !window.confirm(`Ban ${m.nickname} from Shahzaib Room?`)) return;
    if (action === 'unban' && !window.confirm(`Unban ${m.nickname}?`)) return;
    setBusy(true); setError('');
    try {
      await adminCall(action, { user_id: m.user_id, reason, actor_user_id: myId });
      await loadAdminDashboard();
      setToast(action === 'ban' ? `${m.nickname} has been banned.` : `${m.nickname} has been unbanned.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function deleteAdminMessage(m) {
    if (!window.confirm('Permanently delete this message? This cannot be undone.')) return;
    setBusy(true); setError('');
    try {
      await adminCall('delete-message', { message_id: m.id });
      setMessages(prev => prev.filter(x => Number(x.id) !== Number(m.id)));
      await loadAdminDashboard();
      setToast('Message deleted.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function removeMember(m) {
    if (m.user_id === myId) { setToast('You cannot remove yourself.'); return; }
    if (!window.confirm(`Remove "${m.nickname}" from the room?`)) return;
    const delMsgs = window.confirm('Also delete their previous messages?\\n\\nOK = yes, delete their messages too\\nCancel = keep their messages');
    setError(''); setBusy(true);
    try {
      await adminCall('remove', { user_id: m.user_id, delete_messages: delMsgs, actor_user_id: myId });
      if (delMsgs) setMessages(prev => prev.filter(x => x.user_id !== m.user_id));
      await loadAdminDashboard();
      setToast(`${m.nickname} was removed.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function openAdminConsole() {
    setAdminOpen(true); setAdminUnlocked(false); setAdminData(null);
    setAdminTab('dashboard'); setAdminSearch(''); setError(''); setNotice('');
  }
  function closeAdminConsole() {
    setAdminOpen(false); setAdminUnlocked(false); setAdminData(null);
    setAdminPass(''); setAdminSearch(''); setError(''); setNotice('');
  }

  async function copy(text) { await navigator.clipboard.writeText(text); setToast('Copied to clipboard.'); }
  async function leave() {
    localStorage.removeItem('sr-profile'); setProfile(null); setMessages([]); setOwner(null); setAdminPass(''); setProfileOpen(false); setView('gate');
    await supabase.auth.signOut();
  }
  async function installApp() {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); return; }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) setToast('On iPhone: tap Share in Safari, then "Add to Home Screen".');
    else setToast('Open the browser menu and tap "Install app" or "Add to Home screen".');
  }

  // Names we can mention = people who have spoken in the room (the members list itself stays private).
  const names = useMemo(() => [...new Set(messages.map(m => m.nickname).filter(Boolean))], [messages]);
  const mentionPattern = useMemo(() => {
    const all = [...new Set([...names, me].filter(Boolean))].sort((a, b) => b.length - a.length);
    return all.length ? `@(${all.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])` : null;
  }, [names, me]);
  const mentionQuery = message.match(/(^|\s)@([^\s@]*)$/);
  const suggestions = mentionQuery
    ? names.filter(n => n.toLowerCase() !== me.toLowerCase() && n.toLowerCase().includes(mentionQuery[2].toLowerCase())).slice(0, 6)
    : [];
  function pickMention(name) {
    setMessage(message.replace(/(^|\s)@([^\s@]*)$/, (_m, pre) => `${pre}@${name} `));
    inputRef.current?.focus();
  }
  function addEmoji(em) { setMessage(m => (m + em).slice(0, 2000)); inputRef.current?.focus(); }

  // Group consecutive messages from one person, and add date dividers.
  const rows = useMemo(() => {
    let prev = null;
    return messages.map(m => {
      const d = new Date(m.created_at);
      const newDay = !prev || new Date(prev.created_at).toDateString() !== d.toDateString();
      const grouped = !!prev && !newDay && prev.user_id === m.user_id && d - new Date(prev.created_at) < 5 * 60 * 1000;
      prev = m;
      return { m, newDay, grouped, label: newDay ? dayLabel(d) : null };
    });
  }, [messages]);

  if (!configured) return <main className="setup"><div className="setup-card glass"><Sparkles size={30}/><h1>Shahzaib Room</h1><h2>One quick setup required</h2><p>The Supabase project credentials are not configured yet. Follow the step-by-step setup in README.md and add the environment variables in Vercel.</p><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</code></div></main>;

  return <div className="app-shell">
    <div className="liquid-bg" aria-hidden="true"><span className="blob b1"/><span className="blob b2"/><span className="blob b3"/><span className="blob b4"/></div>
    <svg className="svg-defs" width="0" height="0" aria-hidden="true"><defs><filter id="water" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.01" numOctaves="2" seed="7" result="noise"><animate attributeName="baseFrequency" dur="26s" values="0.006 0.01;0.011 0.006;0.006 0.01" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="noise" scale="90" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg>

    <header className="topbar glass">
      <a className="brand" href="#"><span className="brand-icon"><MessageCircle size={18}/></span><span>Shahzaib<span className="brand-light"> Room</span></span></a>
      <div className="top-right">
        {!standalone && <button className="icon-btn" title="Install on your phone" onClick={installApp}><Download size={18}/></button>}
        {owner && <button className="owner-chip" title="Members (only you can see this)" onClick={() => setAdminOpen(true)}><Users size={14}/> {owner.count}</button>}
        <button className="icon-btn" title="Admin Console" onClick={openAdminConsole}><ShieldCheck size={18}/></button>
        {view === 'chat' && <button className="me-btn" title="My profile" onClick={() => setProfileOpen(true)}><Avatar name={me} url={profile?.avatar} cls="sm"/></button>}
        {view === 'chat' && <button className="icon-btn" title="Leave room" onClick={leave}><LogOut size={18}/></button>}
      </div>
    </header>

    {view === 'gate' ? <main className="gate-wrap"><div className="gate-card glass">
      <div className="orb"><LockKeyhole size={26}/></div>
      <div className="eyebrow"><span/> PRIVATE ACCOUNT</div>
      <h1>{loginMode ? <>Welcome<br/><em>back.</em></> : <>One code,<br/><em>and you are in.</em></>}</h1>
      <p className="sub">{loginMode ? 'Sign in with your email or username and password.' : 'Enter your details and one-time invitation code to create an account.'}</p>
      {loginMode ? <form onSubmit={loginRoom} className="gate-form">
        <label>Email or Username</label>
        <div className="code-input plain"><Mail size={18}/><input value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="Email or Username" autoComplete="username" required/></div>
        <label>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" autoComplete="current-password" required/>
        <button className="primary" disabled={busy}>{busy ? 'SIGNING IN…' : 'LOGIN'} <span>↗</span></button>
      </form> : <form onSubmit={joinRoom} className="gate-form">
        <label>Your name</label>
        <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="e.g. Shahzaib" maxLength="28" required/>
        <label>Username</label>
        <input value={username} onChange={e => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0,24))} placeholder="3–24 characters" autoComplete="username" minLength="3" maxLength="24" required/>
        <label>Your email</label>
        <div className="code-input plain"><Mail size={18}/><input type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="aap@example.com" maxLength="254" required/></div>
        <label>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" minLength="8" required/>
        <p className="hint">Your email is visible only to the room owner, not to other members.</p>
        <label>Activation code</label>
        <div className="code-input"><KeyRound size={18}/><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="SHAH-XXXX-XXXX" autoCapitalize="characters" required/></div>
        <button className="primary" disabled={busy}>{busy ? 'CREATING ACCOUNT…' : 'CREATE ACCOUNT & ENTER'} <span>↗</span></button>
      </form>}
      <button type="button" className="secondary account-switch" onClick={() => { setLoginMode(v => !v); setError(''); setPassword(''); }}>{loginMode ? 'New member? Create account with invitation code' : 'Already have an account? Login'}</button>
      {error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}
      <div className="gate-foot"><ShieldCheck size={15}/> {loginMode ? 'Login with your email or username.' : 'Invitation code can be used only once.'}</div>
    </div></main> :
    <main className="chat-wrap"><section className="chat-card glass">
      <div className="chat-head"><div className="head-left"><span className="room-logo"><MessageCircle size={20}/></span><div><h2>Shahzaib Room</h2><small>Private group</small></div></div><span className="live-pill"><i/> LIVE</span></div>
      <div className="messages" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 ? <div className="empty"><div className="empty-icon"><MessageCircle size={26}/></div><h3>The room is yours.</h3><p>Start the conversation. Messages appear here in real time. Type @ to mention someone.</p></div> :
        rows.map(({ m, newDay, grouped, label }) => { const mine = m.user_id === myId; return <MessageRow key={m.id} m={m} mine={mine} grouped={grouped} newDay={newDay} label={label} dp={mine ? profile?.avatar : m.avatar_url} pattern={mentionPattern} me={me}/>; })}
        {typingUsers.length > 0 && <div role="status" aria-live="polite" aria-label={`${typingUsers.slice(0, 3).map(user => user.nickname).join(', ')} ${typingUsers.length === 1 ? 'is' : 'are'} typing`} style={{ display: 'flex', alignItems: 'center', alignSelf: 'flex-start', gap: 9, margin: '4px 12px 8px', padding: '7px 11px', borderRadius: 16, background: 'var(--surface, rgba(120,120,140,.12))', width: 'fit-content' }}>
          <span style={{ display: 'flex', gap: 4, alignItems: 'center', height: 12 }}>
            {[0, 1, 2].map(dot => <span key={dot} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--muted, #9aa4b8)', display: 'block', animation: 'typing-dot-bounce 1s infinite ease-in-out', animationDelay: `${dot * 0.16}s` }}/>)}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted, #9aa4b8)' }}>{typingUsers.length === 1 ? `${typingUsers[0].nickname} typing` : 'Someone typing'}</span>
          <style>{`@keyframes typing-dot-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-4px); opacity: 1; } }`}</style>
        </div>}
        <div ref={bottom}/>
      </div>
      <div className="composer-wrap">
        {!atBottom && <button type="button" className="to-bottom glass" aria-label="Scroll to latest messages" onClick={() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })}><ChevronDown size={20}/></button>}
        {suggestions.length > 0 && <div className="suggest glass">{suggestions.map(n => <button type="button" key={n} onMouseDown={e => e.preventDefault()} onClick={() => pickMention(n)}><Avatar name={n} cls="sm"/>{n}</button>)}</div>}
        {pickerOpen && <div className="picker glass">{EMOJIS.map(em => <button type="button" key={em} onMouseDown={e => e.preventDefault()} onClick={() => addEmoji(em)}><Emoji char={em}/></button>)}</div>}
        <form className="composer glass" onSubmit={sendMessage}>
          <button type="button" className="emoji-btn" aria-label="Emoji" onMouseDown={e => e.preventDefault()} onClick={() => setPickerOpen(o => !o)}><Smile size={20}/></button>
          <input ref={inputRef} value={message} onChange={e => handleMessageChange(e.target.value)} placeholder="Write a message… (@ to mention)" maxLength="2000" enterKeyHint="send"/>
          <button className="send" disabled={!message.trim()} aria-label="Send message" onMouseDown={e => e.preventDefault()}><Send size={18}/></button>
        </form>
      </div>
    </section></main>}

    {profileOpen && view === 'chat' && <div className="modal-backdrop" onClick={() => setProfileOpen(false)}><div className="admin-modal glass profile-modal" onClick={e => e.stopPropagation()}>
      <button className="close" onClick={() => setProfileOpen(false)}>×</button>
      <div className="eyebrow"><span/> MY PROFILE</div>
      <div className="dp-wrap">
        <Avatar name={me} url={profile?.avatar} cls="xl"/>
        <button type="button" className="dp-cam" aria-label="Change photo" disabled={dpBusy} onClick={() => fileRef.current?.click()}><Camera size={18}/></button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={changeDp}/>
      </div>
      <h2 className="center">{me}</h2>
      <p className="center">{dpBusy ? 'Uploading photo…' : 'Tap the camera icon to set your profile photo. It will appear next to your name in the chat.'}</p>
      <div className="row2">
        <button className="secondary" disabled={dpBusy} onClick={() => fileRef.current?.click()}><Camera size={14}/> {profile?.avatar ? 'Change photo' : 'Add photo'}</button>
        <button className="secondary" disabled={dpBusy || !profile?.avatar} onClick={removeDp}><Trash2 size={14}/> Remove photo</button>
      </div>
      <hr/>
      <h3>Set up login details</h3>
      <p className="center">Existing members can set their username, email, and password here. No new invitation code is required.</p>
      <form className="gate-form" onSubmit={saveAccountCredentials}>
        <label>Username</label>
        <input value={accountUsername} onChange={e => setAccountUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0,24))} placeholder={profile?.username || 'Choose a username'} minLength="3" maxLength="24" required/>
        <label>Email</label>
        <input type="email" value={accountEmail} onChange={e => setAccountEmail(e.target.value)} placeholder="aap@example.com" maxLength="254" required/>
        <label>New password</label>
        <input type="password" value={accountPassword} onChange={e => setAccountPassword(e.target.value)} placeholder="At least 8 characters" minLength="8" required/>
        <button className="primary" disabled={busy}>{busy ? 'SAVING…' : 'SAVE LOGIN DETAILS'}</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div></div>}

    {adminOpen && <div className="modal-backdrop admin-backdrop" onClick={closeAdminConsole}>
      <div className={`admin-console ${adminUnlocked ? 'unlocked' : 'locked'}`} onClick={e => e.stopPropagation()}>
        {!adminUnlocked ? <div className="admin-login-card">
          <button className="admin-close" onClick={closeAdminConsole} aria-label="Close admin console">×</button>
          <div className="admin-brand-mark"><ShieldCheck size={22}/></div>
          <div className="admin-kicker">SHAHZAIB ROOM / SECURE ACCESS</div>
          <h2>Admin Panel</h2>
          <p>Unlock the private management console to moderate members and messages.</p>
          <label>Admin password</label>
          <input type="password" value={adminPass} onChange={e => setAdminPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && unlockAdmin()} placeholder="Enter your admin password" autoComplete="current-password"/>
          <button className="admin-primary" onClick={unlockAdmin} disabled={busy || !adminPass}>{busy ? 'VERIFYING…' : 'UNLOCK ADMIN CONSOLE'} <span>↗</span></button>
          {error && <p className="admin-error">{error}</p>}
          <small><ShieldCheck size={13}/> Admin actions are protected and activity is recorded.</small>
        </div> : <>
          <aside className="admin-sidebar">
            <div className="admin-sidebar-brand"><span><ShieldCheck size={20}/></span><div><b>Admin Panel</b><small>Management Console</small></div><button className="admin-mobile-close" onClick={closeAdminConsole}>×</button></div>
            <div className="admin-sidebar-label">WORKSPACE</div>
            <button className={adminTab === 'dashboard' ? 'active' : ''} onClick={() => setAdminTab('dashboard')}><LayoutDashboard size={17}/> Dashboard</button>
            <button className={adminTab === 'members' ? 'active' : ''} onClick={() => setAdminTab('members')}><Users size={17}/> Members <span>{adminData?.stats?.total_members || 0}</span></button>
            <button className={adminTab === 'messages' ? 'active' : ''} onClick={() => setAdminTab('messages')}><MessageSquare size={17}/> Messages</button>
            <button className={adminTab === 'activity' ? 'active' : ''} onClick={() => setAdminTab('activity')}><Activity size={17}/> Activity Logs</button>
            <button className={adminTab === 'codes' ? 'active' : ''} onClick={() => setAdminTab('codes')}><KeyRound size={17}/> Invitation Codes</button>
            <div className="admin-sidebar-foot"><span className="admin-avatar">AD</span><div><b>Admin User</b><small>Super Admin</small></div></div>
          </aside>
          <section className="admin-main">
            <header className="admin-topbar">
              <div><div className="admin-mobile-title">Admin Panel</div><h2>{({dashboard:'Dashboard',members:'Member Management',messages:'Message Moderation',activity:'Activity Logs',codes:'Invitation Codes'})[adminTab]}</h2><p>{adminTab === 'dashboard' ? 'Welcome back, Admin' : 'Manage your private room securely'}</p></div>
              <div className="admin-top-actions">
                <div className="admin-search"><SearchIcon size={15}/><input value={adminSearch} onChange={e => setAdminSearch(e.target.value)} placeholder="Quick search…"/></div>
                <button title="Refresh dashboard" onClick={refreshAdmin} disabled={busy}><RefreshCw size={17}/></button>
                <button title="Close admin console" onClick={closeAdminConsole}>×</button>
              </div>
            </header>
            {error && <div className="admin-alert">{error}</div>}
            {adminTab === 'dashboard' && <div className="admin-view">
              <div className="admin-stat-grid">
                <div className="admin-stat"><span>Total Users</span><b>{adminData?.stats?.total_members ?? 0}</b><small><Users size={14}/> Room members</small></div>
                <div className="admin-stat"><span>Messages (latest 80)</span><b>{adminData?.stats?.total_messages ?? 0}</b><small><MessageSquare size={14}/> Recent room messages</small></div>
                <div className="admin-stat"><span>Active in 24 hours</span><b>{adminData?.stats?.active_24h ?? 0}</b><small><Activity size={14}/> Based on last seen</small></div>
                <div className="admin-stat"><span>Banned Users</span><b>{adminData?.stats?.banned_members ?? 0}</b><small><BanIcon size={14}/> Restricted accounts</small></div>
              </div>
              <div className="admin-dashboard-grid">
                <section className="admin-panel admin-panel-wide">
                  <div className="admin-panel-head"><div><h3>Recent Activity</h3><p>Latest administrative actions</p></div><button onClick={() => setAdminTab('activity')}>View all</button></div>
                  <div className="admin-activity-list">
                    {(adminData?.activity || []).slice(0,6).map(item => <div className="admin-activity-row" key={item.id}><span className="admin-activity-icon"><Activity size={15}/></span><div><b>{item.action.replaceAll('_',' ')}</b><small>{item.target_nickname || 'System'} · {new Date(item.created_at).toLocaleString()}</small></div></div>)}
                    {!adminData?.activity?.length && <div className="admin-empty">No admin activity recorded yet.</div>}
                  </div>
                </section>
                <section className="admin-panel admin-quick">
                  <div className="admin-panel-head"><div><h3>Quick Actions</h3><p>Common administration tasks</p></div></div>
                  <button onClick={() => setAdminTab('members')}><Users size={17}/><span><b>Manage members</b><small>Ban, unban or remove members</small></span></button>
                  <button onClick={() => setAdminTab('messages')}><MessageSquare size={17}/><span><b>Moderate messages</b><small>Delete inappropriate messages</small></span></button>
                  <button onClick={makeCode} disabled={busy}><Plus size={17}/><span><b>Generate invitation</b><small>Create a one-time access code</small></span></button>
                </section>
              </div>
            </div>}
            {adminTab === 'members' && <div className="admin-view">
              <div className="admin-view-heading"><div><h3>Members</h3><p>Ban, restore or remove room access. Current owner account cannot be moderated.</p></div><span>{adminData?.members?.length || 0} total</span></div>
              <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Member</th><th>Email</th><th>Joined</th><th>Last seen</th><th>Messages</th><th>Status</th><th>Actions</th></tr></thead><tbody>
                {(adminData?.members || []).filter(m => `${m.nickname} ${m.username || ''} ${m.email || ''}`.toLowerCase().includes(adminSearch.toLowerCase())).map(m => <tr key={m.user_id}>
                  <td><div className="admin-member"><Avatar name={m.nickname} url={AVATAR_URL(m.user_id)} cls="sm"/><span><b>{m.nickname}</b><small>@{m.username || 'no username'}</small></span></div></td>
                  <td>{m.email || '—'}</td><td>{new Date(m.joined_at).toLocaleDateString()}</td><td>{m.last_seen ? new Date(m.last_seen).toLocaleString() : '—'}</td><td>{m.message_count || 0}</td>
                  <td><span className={`admin-status ${m.is_banned ? 'banned' : 'active'}`}>{m.is_banned ? 'Banned' : 'Active'}</span></td>
                  <td><div className="admin-row-actions"><button disabled={busy || m.user_id === myId} onClick={() => toggleMemberBan(m)} title={m.is_banned ? 'Unban member' : 'Ban member'}>{m.is_banned ? <CheckCircle2 size={15}/> : <BanIcon size={15}/>}</button><button className="danger" disabled={busy || m.user_id === myId} onClick={() => removeMember(m)} title="Remove member"><UserMinus size={15}/></button></div></td>
                </tr>)}
              </tbody></table>{!adminData?.members?.length && <div className="admin-empty">No members found.</div>}</div>
            </div>}
            {adminTab === 'messages' && <div className="admin-view">
              <div className="admin-view-heading"><div><h3>Message Moderation</h3><p>Review recent messages and permanently remove selected messages.</p></div><span>{adminData?.messages?.length || 0} recent</span></div>
              <div className="admin-message-list">{(adminData?.messages || []).filter(m => `${m.nickname} ${m.body}`.toLowerCase().includes(adminSearch.toLowerCase())).map(m => <article className="admin-message-row" key={m.id}><div className="admin-message-avatar">{(m.nickname || '?')[0]}</div><div className="admin-message-copy"><div><b>{m.nickname}</b><time>{new Date(m.created_at).toLocaleString()}</time></div><p>{m.body}</p></div><button className="danger" disabled={busy} onClick={() => deleteAdminMessage(m)} title="Delete message"><Trash2 size={16}/></button></article>)}
                {!adminData?.messages?.length && <div className="admin-empty">No messages found.</div>}
              </div>
            </div>}
            {adminTab === 'activity' && <div className="admin-view">
              <div className="admin-view-heading"><div><h3>Activity Logs</h3><p>Administrative actions recorded by the server.</p></div><span>{adminData?.activity?.length || 0} events</span></div>
              <div className="admin-activity-full">{(adminData?.activity || []).filter(a => `${a.action} ${a.target_nickname || ''}`.toLowerCase().includes(adminSearch.toLowerCase())).map(a => <div className="admin-activity-full-row" key={a.id}><span className="admin-activity-icon"><Clock3 size={15}/></span><div><b>{a.action.replaceAll('_',' ')}</b><small>{a.target_nickname || 'System'} · {a.actor || 'Owner'}</small></div><time>{new Date(a.created_at).toLocaleString()}</time></div>)}
                {!adminData?.activity?.length && <div className="admin-empty">No activity yet. New admin actions will appear here.</div>}
              </div>
            </div>}
            {adminTab === 'codes' && <div className="admin-view">
              <div className="admin-view-heading"><div><h3>Invitation Codes</h3><p>Generate one-time codes and review their usage.</p></div><button className="admin-primary small" disabled={busy} onClick={makeCode}><Plus size={15}/> Generate code</button></div>
              {newCode && <div className="admin-new-code"><div><small>NEW ONE-TIME CODE</small><b>{newCode}</b></div><button onClick={() => copy(newCode)}><Copy size={15}/> Copy</button></div>}
              <div className="admin-code-list">{(adminData?.codes || codes || []).map((c,i) => <div key={i}><span><KeyRound size={15}/>{c.code_hint}</span><b className={c.used_at ? 'used' : 'available'}>{c.used_at ? 'USED' : 'AVAILABLE'}</b><small>{new Date(c.created_at).toLocaleString()}</small></div>)}
                {!adminData?.codes?.length && <div className="admin-empty">No invitation codes yet.</div>}
              </div>
            </div>}
            {notice && <div className="admin-notice">{notice}</div>}
            <footer className="admin-footer"><ShieldCheck size={14}/> Shahzaib Room · Secure management console <span>All times shown in your local timezone</span></footer>
          </section>
        </>}
      </div>
    </div>}
    {toast && <div className="toast glass">{toast}</div>}
  </div>;
}
export default App;
