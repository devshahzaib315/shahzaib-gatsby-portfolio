import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, configured } from './supabase';
import { ShieldCheck, LockKeyhole, MessageCircle, Users, Send, Copy, Plus, LogOut, KeyRound, Smile, Download, Sparkles, Mail, Camera, Trash2, UserMinus, ChevronDown } from 'lucide-react';

const BASE = import.meta.env.VITE_SUPABASE_URL;
const FN = `${BASE}/functions/v1`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const AVATAR_URL = uid => `${BASE}/storage/v1/object/public/avatars/${uid}/avatar.jpg`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------- iOS-style emoji ----------
   iPhone / iPad / Mac already draw real Apple emoji. Everywhere else we swap emoji for Apple-style
   images and quietly fall back to the device's own emoji if an image fails to load. */
const IS_APPLE = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent);
const EMOJI_CDN = 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/';
const EMOJI_RE = /(\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)/gu;
const EMOJIS = '😀 😁 😂 🤣 😊 😍 😘 😎 🤩 🥳 😇 🙂 😉 😋 😜 🤔 🤗 😴 😢 😭 😡 🥺 😱 🤯 🙄 😬 😅 🙏 👍 👎 👏 🙌 🤝 💪 👀 🔥 ✨ ⭐ 🌟 💯 🎉 🎁 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 🎵 ☕ 🍕 🍔 🍟 🍫 🎂 🌹 🌸 🌙 ☀️ ⚡ 🚀 🏆 ⚽ 🎮 📱 💻 📷 🔒 ✅ ❌ ⚠️'.split(' ');

function Emoji({ char }) {
  const [step] = useState(0);
  return <span className="emoji-native">{char}</span>;
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
  if (url && !bad) return <img className={`avatar ${cls}`} src={url} alt="" draggable="false" onError={() => setBad(true)} />;
  return <span className={`avatar ${cls}`}>{(name || '?')[0]?.toUpperCase()}</span>;
}
// Centre-crop to a square and shrink to 256px JPEG so uploads stay tiny and fast.
async function squareJpeg(file, size = 256) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not process the image.'))), 'image/jpeg', 0.86));
}
function dayLabel(d) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(() => { try { return JSON.parse(localStorage.getItem('sr-profile') || 'null'); } catch { return null; } });
  const [view, setView] = useState('gate');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [dpBusy, setDpBusy] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [codes, setCodes] = useState([]);
  const [owner, setOwner] = useState(null); // { count, members } — only filled after the admin password is verified
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
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
      .subscribe();
    return () => { supabase.removeChannel(channel); };
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

  // Owner only: keep the member list fresh while the owner is unlocked.
  const ownerUnlocked = owner !== null;
  useEffect(() => {
    if (!ownerUnlocked || !adminPass) return;
    const t = setInterval(() => { adminCall('members').then(setOwner).catch(() => {}); }, 20000);
    return () => clearInterval(t);
  }, [ownerUnlocked, adminPass]);

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
      if (!configured) throw new Error('Please configure Supabase first. Follow the instructions in README.md.');
      if (!nickname.trim() || !code.trim()) throw new Error('Please enter your name and activation code.');
      const cleanEmail = email.trim().toLowerCase();
      if (!EMAIL_RE.test(cleanEmail)) throw new Error('Please enter a valid email address.');
      let current = session;
      if (!current) {
        const { data, error: authError } = await supabase.auth.signInAnonymously();
        if (authError) throw authError;
        current = data.session;
      }
      const response = await fetch(`${FN}/redeem-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${current.access_token}` },
        body: JSON.stringify({ code: code.trim(), nickname: nickname.trim().slice(0, 28), email: cleanEmail })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The activation code was not accepted.');
      saveProfile({ nickname: nickname.trim().slice(0, 28), avatar: null });
      setView('chat'); setNotice('Welcome to Shahzaib Room.');
      setTimeout(() => setProfileOpen(true), 600); // invite them to add a photo right away
    } catch (err) { setError(err.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  async function sendMessage(e) {
    e.preventDefault(); if (!message.trim() || !session) return;
    const body = message.trim().slice(0, 2000); setMessage(''); setPickerOpen(false);
    inputRef.current?.focus(); // keep the phone keyboard open after sending
    nearBottom.current = true;
    const { error: sendError } = await supabase.from('messages').insert({ user_id: session.user.id, nickname: profile.nickname, body, avatar_url: profile.avatar || null });
    if (sendError) { setToast(sendError.message); setMessage(body); }
  }

  async function changeDp(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !session) return;
    if (!file.type.startsWith('image/')) { setToast('Please select an image file.'); return; }
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
    try { await supabase.storage.from('avatars').remove([`${session.user.id}/avatar.jpg`]); saveProfile({ ...profile, avatar: null }); setToast('Profile photo removed.'); }
    catch (err) { setToast(err.message || 'Could not remove the profile photo.'); }
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
    if (!response.ok) throw new Error(data.error || 'The request failed.');
    return data;
  }
  async function makeCode() {
    setError(''); setNotice(''); setBusy(true);
    try { const data = await adminCall('create'); setNewCode(data.code); setNotice('A new one-time activation code has been generated.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function fetchCodes() { setError(''); try { setCodes((await adminCall('list')).codes || []); } catch (err) { setError(err.message); } }
  async function fetchMembers() { setError(''); try { setOwner(await adminCall('members')); } catch (err) { setError(err.message); } }
  async function removeMember(m) {
    if (m.user_id === myId) { setToast('You cannot remove yourself.'); return; }
    if (!window.confirm(`Remove "${m.nickname}" from the room?`)) return;
    const delMsgs = window.confirm('Also delete their previous messages?\n\nOK = delete messages too\nCancel = keep messages');
    setError('');
    try {
      await adminCall('remove', { user_id: m.user_id, delete_messages: delMsgs });
      setOwner(await adminCall('members'));
      if (delMsgs) setMessages(prev => prev.filter(x => x.user_id !== m.user_id));
      setToast(`${m.nickname} has been removed.`);
    } catch (err) { setError(err.message); }
  }

  async function copy(text) { await navigator.clipboard.writeText(text); setToast('Copied to clipboard.'); }
  async function leave() {
    localStorage.removeItem('sr-profile'); setProfile(null); setMessages([]); setOwner(null); setAdminPass(''); setProfileOpen(false); setView('gate');
    await supabase.auth.signOut();
  }
  async function installApp() {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); return; }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) setToast('On iPhone: tap Share in Safari, then select "Add to Home Screen".');
    else setToast('Open your browser menu and select "Install app" or "Add to Home screen".');
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
  const isMentionedMe = body => !!me && new RegExp(`@${escapeRe(me)}(?![\\p{L}\\p{N}_])`, 'iu').test(body);
  const emojiOnly = body => body.replace(EMOJI_RE, '').trim() === '' && (body.match(EMOJI_RE) || []).length <= 3;

  // Group consecutive messages from one person, and add "date" day dividers.
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

  if (!configured) return <main className="setup"><div className="setup-card glass"><Sparkles size={30}/><h1>Shahzaib Room</h1><h2>One quick setup required</h2><p>Supabase project credentials are not configured yet. Follow the step-by-step instructions in README.md and add the environment variables in Vercel.</p><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</code></div></main>;

  return <div className="app-shell">
    <div className="liquid-bg" aria-hidden="true"><span className="blob b1"/><span className="blob b2"/><span className="blob b3"/><span className="blob b4"/></div>
    <svg className="svg-defs" width="0" height="0" aria-hidden="true"><defs><filter id="water" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.01" numOctaves="2" seed="7" result="noise"><animate attributeName="baseFrequency" dur="26s" values="0.006 0.01;0.011 0.006;0.006 0.01" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="noise" scale="90" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg>

    <header className="topbar glass">
      <a className="brand" href="#"><span className="brand-icon"><MessageCircle size={18}/></span><span>Shahzaib<span className="brand-light"> Room</span></span></a>
      <div className="top-right">
        {!standalone && <button className="icon-btn" title="Install app on your phone" onClick={installApp}><Download size={18}/></button>}
        {owner && <button className="owner-chip" title="Members (visible only to you)" onClick={() => setAdminOpen(true)}><Users size={14}/> {owner.count}</button>}
        <button className="icon-btn" title="Owner" onClick={() => { setAdminOpen(!adminOpen); setError(''); }}><ShieldCheck size={18}/></button>
        {view === 'chat' && <button className="me-btn" title="My profile" onClick={() => setProfileOpen(true)}><Avatar name={me} url={profile?.avatar} cls="sm"/></button>}
        {view === 'chat' && <button className="icon-btn" title="Leave room" onClick={leave}><LogOut size={18}/></button>}
      </div>
    </header>

    {view === 'gate' ? <main className="gate-wrap"><div className="gate-card glass">
      <div className="orb"><LockKeyhole size={26}/></div>
      <div className="eyebrow"><span/> INVITATION ONLY</div>
      <h1>One code,<br/><em>your room awaits.</em></h1>
      <p className="sub">This is a private space. Enter your personal invitation code to join the room.</p>
      <form onSubmit={joinRoom} className="gate-form">
        <label>Your name</label>
        <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="e.g. Shahzaib" maxLength="28" required/>
        <label>Your email</label>
        <div className="code-input plain"><Mail size={18}/><input type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" maxLength="254" required/></div>
        <p className="hint">Your email is visible only to the room owner, not to other members.</p>
        <label>Activation code</label>
        <div className="code-input"><KeyRound size={18}/><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="SHAH-XXXX-XXXX" autoCapitalize="characters" required/></div>
        <button className="primary" disabled={busy}>{busy ? 'VERIFYING…' : 'ENTER ROOM'} <span>↗</span></button>
      </form>
      {error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}
      <div className="gate-foot"><ShieldCheck size={15}/> Your invitation is private and can only be used once.</div>
    </div></main> :
    <main className="chat-wrap"><section className="chat-card glass">
      <div className="chat-head"><div className="head-left"><span className="room-logo"><MessageCircle size={20}/></span><div><h2>Shahzaib Room</h2><small>Private group</small></div></div><span className="live-pill"><i/> LIVE</span></div>
      <div className="messages" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 ? <div className="empty"><div className="empty-icon"><MessageCircle size={26}/></div><h3>The room is yours.</h3><p>Start the conversation. Messages appear here in real time. Type @ to mention someone.</p></div> :
        rows.map(({ m, newDay, grouped, label }) => { const mine = m.user_id === myId; const dp = mine ? profile?.avatar : m.avatar_url; return <React.Fragment key={m.id}>
          {newDay && <div className="day-sep"><span>{label}</span></div>}
          <div className={`message-row ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${!mine && isMentionedMe(m.body) ? 'mentioned' : ''}`}>
            <div className="avatar-slot">{!grouped && <Avatar name={m.nickname} url={dp}/>}</div>
            <div className="message-content">
              {!grouped && <div className="message-meta"><b>{mine ? 'You' : m.nickname}</b><time>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>}
              <div className={`bubble ${emojiOnly(m.body) ? 'big-emoji' : ''}`}><RichText body={m.body} pattern={mentionPattern} me={me}/></div>
            </div>
          </div></React.Fragment>; })}
        <div ref={bottom}/>
      </div>
      <div className="composer-wrap">
        {!atBottom && <button type="button" className="to-bottom glass" aria-label="Neeche jayein" onClick={() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })}><ChevronDown size={20}/></button>}
        {suggestions.length > 0 && <div className="suggest glass">{suggestions.map(n => <button type="button" key={n} onMouseDown={e => e.preventDefault()} onClick={() => pickMention(n)}><Avatar name={n} cls="sm"/>{n}</button>)}</div>}
        {pickerOpen && <div className="picker glass">{EMOJIS.map(em => <button type="button" key={em} onMouseDown={e => e.preventDefault()} onClick={() => addEmoji(em)}><Emoji char={em}/></button>)}</div>}
        <form className="composer glass" onSubmit={sendMessage}>
          <button type="button" className="emoji-btn" aria-label="Emoji" onMouseDown={e => e.preventDefault()} onClick={() => setPickerOpen(o => !o)}><Smile size={20}/></button>
          <input ref={inputRef} value={message} onChange={e => setMessage(e.target.value)} placeholder="Write a message… (@ to mention)" maxLength="2000" enterKeyHint="send"/>
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
      <p className="center">{dpBusy ? 'Uploading photo…' : 'Tap the camera icon to upload a profile photo. It will appear next to your name in chat.'}</p>
      <div className="row2">
        <button className="secondary" disabled={dpBusy} onClick={() => fileRef.current?.click()}><Camera size={14}/> {profile?.avatar ? 'Change photo' : 'Upload photo'}</button>
        <button className="secondary" disabled={dpBusy || !profile?.avatar} onClick={removeDp}><Trash2 size={14}/> Remove photo</button>
      </div>
    </div></div>}

    {adminOpen && <div className="modal-backdrop" onClick={() => setAdminOpen(false)}><div className="admin-modal glass" onClick={e => e.stopPropagation()}>
      <button className="close" onClick={() => setAdminOpen(false)}>×</button>
      <div className="eyebrow"><span/> OWNER ACCESS</div>
      <h2>Owner console</h2>
      <p>Only the room owner can view invitations, members, and their email addresses.</p>
      <label>Admin password</label>
      <input type="password" value={adminPass} onChange={e => setAdminPass(e.target.value)} placeholder="Enter your admin password"/>
      <button className="primary" onClick={makeCode} disabled={busy}><Plus size={17}/> GENERATE ONE-TIME CODE</button>
      {newCode && <div className="generated"><small>NEW ACTIVATION CODE</small><strong>{newCode}</strong><button onClick={() => copy(newCode)}><Copy size={15}/> Copy code</button></div>}
      <div className="row2"><button className="secondary" onClick={fetchCodes}>Code history</button><button className="secondary" onClick={fetchMembers}><Users size={14}/> View members</button></div>
      {owner && <div className="members-box"><div className="members-count"><b>{owner.count}</b><span>members</span></div>{owner.members.map(m => <div className="member-line" key={m.user_id}>
        <Avatar name={m.nickname} url={AVATAR_URL(m.user_id)} cls="sm"/>
        <span className="who"><b>{m.nickname}</b><small>{m.email || 'No email provided'}</small></span>
        {m.email && <button className="mini-btn" title="Copy email" onClick={() => copy(m.email)}><Copy size={14}/></button>}
        <button className="rm-btn" title="Remove from room" onClick={() => removeMember(m)}><UserMinus size={15}/></button>
      </div>)}</div>}
      {codes.length > 0 && <div className="code-history">{codes.map((c, i) => <div key={i}><code>{c.code_hint}</code><span>{c.used_at ? 'USED' : 'AVAILABLE'}</span></div>)}</div>}
      {error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}
    </div></div>}

    {toast && <div className="toast glass">{toast}</div>}
  </div>;
}
export default App;
