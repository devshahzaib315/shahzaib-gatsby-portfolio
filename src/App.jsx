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
  const [step, setStep] = useState(0);
  const base = Array.from(char).map(c => c.codePointAt(0).toString(16).padStart(4, '0')).join('-');
  const tries = base.includes('fe0f') ? [base] : [base, `${base}-fe0f`];
  if (IS_APPLE || step >= tries.length) return <span className="emoji-native">{char}</span>;
  return <img className="emoji" src={`${EMOJI_CDN}${tries[step]}.png`} alt={char} draggable="false" onError={() => setStep(s => s + 1)} />;
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
  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Photo process nahi hui.'))), 'image/jpeg', 0.86));
}
function dayLabel(d) {
  const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Aaj';
  if (d.toDateString() === y.toDateString()) return 'Kal';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
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
      if (!stop && !e && data === false) { await leave(); setToast('Aapko room se hata diya gaya hai.'); }
    };
    const first = setTimeout(check, 1500);
    const t = setInterval(check, 15000);
    return () => { stop = true; clearTimeout(first); clearInterval(t); };
  }, [view, session]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (nearBottom.current || last?.user_id === myId) bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
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
    setTimeout(() => bottom.current?.scrollIntoView(), 50);
  }
  function saveProfile(p) { localStorage.setItem('sr-profile', JSON.stringify(p)); setProfile(p); }

  async function joinRoom(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (!configured) throw new Error('Pehle Supabase setup karein. README ki instructions follow karein.');
      if (!nickname.trim() || !code.trim()) throw new Error('Apna naam aur activation code enter karein.');
      const cleanEmail = email.trim().toLowerCase();
      if (!EMAIL_RE.test(cleanEmail)) throw new Error('Sahi email address likhein.');
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
      if (!response.ok) throw new Error(result.error || 'Activation code accept nahi hua.');
      saveProfile({ nickname: nickname.trim().slice(0, 28), avatar: null });
      setView('chat'); setNotice('Welcome to Shahzaib Room.');
      setTimeout(() => setProfileOpen(true), 600); // invite them to add a photo right away
    } catch (err) { setError(err.message || 'Kuch ghalat ho gaya.'); }
    finally { setBusy(false); }
  }

  async function sendMessage(e) {
    e.preventDefault(); if (!message.trim() || !session) return;
    const body = message.trim().slice(0, 2000); setMessage(''); setPickerOpen(false);
    nearBottom.current = true;
    const { error: sendError } = await supabase.from('messages').insert({ user_id: session.user.id, nickname: profile.nickname, body, avatar_url: profile.avatar || null });
    if (sendError) { setToast(sendError.message); setMessage(body); }
  }

  async function changeDp(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file || !session) return;
    if (!file.type.startsWith('image/')) { setToast('Sirf photo (tasveer) chunein.'); return; }
    setDpBusy(true);
    try {
      const blob = await squareJpeg(file, 256);
      const path = `${session.user.id}/avatar.jpg`;
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
      if (upErr) throw upErr;
      saveProfile({ ...profile, avatar: `${AVATAR_URL(session.user.id)}?v=${Date.now()}` });
      setToast('Profile photo lag gayi.');
    } catch (err) { setToast(err.message || 'Photo upload nahi hui.'); }
    finally { setDpBusy(false); }
  }
  async function removeDp() {
    if (!session) return;
    setDpBusy(true);
    try { await supabase.storage.from('avatars').remove([`${session.user.id}/avatar.jpg`]); saveProfile({ ...profile, avatar: null }); setToast('Photo hata di gayi.'); }
    catch (err) { setToast(err.message || 'Photo nahi hati.'); }
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
    if (!response.ok) throw new Error(data.error || 'Request nakam ho gayi.');
    return data;
  }
  async function makeCode() {
    setError(''); setNotice(''); setBusy(true);
    try { const data = await adminCall('create'); setNewCode(data.code); setNotice('Naya one-time activation code generate ho gaya.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function fetchCodes() { setError(''); try { setCodes((await adminCall('list')).codes || []); } catch (err) { setError(err.message); } }
  async function fetchMembers() { setError(''); try { setOwner(await adminCall('members')); } catch (err) { setError(err.message); } }
  async function removeMember(m) {
    if (m.user_id === myId) { setToast('Aap khud ko nahi hata sakte.'); return; }
    if (!window.confirm(`"${m.nickname}" ko room se hata dein?`)) return;
    const delMsgs = window.confirm('Unke purane messages bhi delete karein?\n\nOK = haan, messages bhi delete\nCancel = messages rehne dein');
    setError('');
    try {
      await adminCall('remove', { user_id: m.user_id, delete_messages: delMsgs });
      setOwner(await adminCall('members'));
      if (delMsgs) setMessages(prev => prev.filter(x => x.user_id !== m.user_id));
      setToast(`${m.nickname} ko hata diya gaya.`);
    } catch (err) { setError(err.message); }
  }

  async function copy(text) { await navigator.clipboard.writeText(text); setToast('Copy ho gaya.'); }
  async function leave() {
    localStorage.removeItem('sr-profile'); setProfile(null); setMessages([]); setOwner(null); setAdminPass(''); setProfileOpen(false); setView('gate');
    await supabase.auth.signOut();
  }
  async function installApp() {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice; setInstallEvt(null); return; }
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) setToast('iPhone par: Safari mein Share dabao, phir "Add to Home Screen".');
    else setToast('Browser menu mein "Install app" ya "Add to Home screen" dabao.');
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

  // Group consecutive messages from one person, and add "Aaj / Kal" day dividers.
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

  if (!configured) return <main className="setup"><div className="setup-card glass"><Sparkles size={30}/><h1>Shahzaib Room</h1><h2>One quick setup required</h2><p>Supabase project credentials abhi configure nahi hain. README.md mein step-by-step setup diya gaya hai. Vercel par environment variables add karein.</p><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</code></div></main>;

  return <div className="app-shell">
    <div className="liquid-bg" aria-hidden="true"><span className="blob b1"/><span className="blob b2"/><span className="blob b3"/><span className="blob b4"/></div>
    <svg className="svg-defs" width="0" height="0" aria-hidden="true"><defs><filter id="water" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.01" numOctaves="2" seed="7" result="noise"><animate attributeName="baseFrequency" dur="26s" values="0.006 0.01;0.011 0.006;0.006 0.01" repeatCount="indefinite"/></feTurbulence><feDisplacementMap in="SourceGraphic" in2="noise" scale="90" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg>

    <header className="topbar glass">
      <a className="brand" href="#"><span className="brand-icon"><MessageCircle size={18}/></span><span>Shahzaib<span className="brand-light"> Room</span></span></a>
      <div className="top-right">
        {!standalone && <button className="icon-btn" title="Phone mein install karo" onClick={installApp}><Download size={18}/></button>}
        {owner && <button className="owner-chip" title="Members (sirf aap dekh sakte hain)" onClick={() => setAdminOpen(true)}><Users size={14}/> {owner.count}</button>}
        <button className="icon-btn" title="Owner" onClick={() => { setAdminOpen(!adminOpen); setError(''); }}><ShieldCheck size={18}/></button>
        {view === 'chat' && <button className="me-btn" title="Meri profile" onClick={() => setProfileOpen(true)}><Avatar name={me} url={profile?.avatar} cls="sm"/></button>}
        {view === 'chat' && <button className="icon-btn" title="Leave room" onClick={leave}><LogOut size={18}/></button>}
      </div>
    </header>

    {view === 'gate' ? <main className="gate-wrap"><div className="gate-card glass">
      <div className="orb"><LockKeyhole size={26}/></div>
      <div className="eyebrow"><span/> INVITATION ONLY</div>
      <h1>Ek code,<br/><em>aur aap andar.</em></h1>
      <p className="sub">Ye ek private jagah hai. Apna personal invitation code daal kar room mein enter hon.</p>
      <form onSubmit={joinRoom} className="gate-form">
        <label>Aapka naam</label>
        <input value={nickname} onChange={e => setNickname(e.target.value)} placeholder="e.g. Shahzaib" maxLength="28" required/>
        <label>Aapki email</label>
        <div className="code-input plain"><Mail size={18}/><input type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="aap@example.com" maxLength="254" required/></div>
        <p className="hint">Email sirf room ke malik ko nazar aati hai, doosre members ko nahi.</p>
        <label>Activation code</label>
        <div className="code-input"><KeyRound size={18}/><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="SHAH-XXXX-XXXX" autoCapitalize="characters" required/></div>
        <button className="primary" disabled={busy}>{busy ? 'VERIFYING…' : 'ENTER ROOM'} <span>↗</span></button>
      </form>
      {error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}
      <div className="gate-foot"><ShieldCheck size={15}/> Aapka invitation private aur sirf ek bar use hota hai.</div>
    </div></main> :
    <main className="chat-wrap"><section className="chat-card glass">
      <div className="chat-head"><div className="head-left"><span className="room-logo"><MessageCircle size={20}/></span><div><h2>Shahzaib Room</h2><small>Private group</small></div></div><span className="live-pill"><i/> LIVE</span></div>
      <div className="messages" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 ? <div className="empty"><div className="empty-icon"><MessageCircle size={26}/></div><h3>Room aapka hai.</h3><p>Baat shuru karein. Message yahan realtime mein nazar aayega. Kisi ko bulane ke liye @ likhein.</p></div> :
        rows.map(({ m, newDay, grouped, label }) => { const mine = m.user_id === myId; const dp = mine ? profile?.avatar : m.avatar_url; return <React.Fragment key={m.id}>
          {newDay && <div className="day-sep"><span>{label}</span></div>}
          <div className={`message-row ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''} ${!mine && isMentionedMe(m.body) ? 'mentioned' : ''}`}>
            <div className="avatar-slot">{!grouped && <Avatar name={m.nickname} url={dp}/>}</div>
            <div className="message-content">
              {!grouped && <div className="message-meta"><b>{mine ? 'Aap' : m.nickname}</b><time>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>}
              <div className={`bubble ${emojiOnly(m.body) ? 'big-emoji' : ''}`}><RichText body={m.body} pattern={mentionPattern} me={me}/></div>
            </div>
          </div></React.Fragment>; })}
        <div ref={bottom}/>
      </div>
      <div className="composer-wrap">
        {!atBottom && <button type="button" className="to-bottom glass" aria-label="Neeche jayein" onClick={() => bottom.current?.scrollIntoView({ behavior: 'smooth' })}><ChevronDown size={20}/></button>}
        {suggestions.length > 0 && <div className="suggest glass">{suggestions.map(n => <button type="button" key={n} onMouseDown={e => e.preventDefault()} onClick={() => pickMention(n)}><Avatar name={n} cls="sm"/>{n}</button>)}</div>}
        {pickerOpen && <div className="picker glass">{EMOJIS.map(em => <button type="button" key={em} onMouseDown={e => e.preventDefault()} onClick={() => addEmoji(em)}><Emoji char={em}/></button>)}</div>}
        <form className="composer glass" onSubmit={sendMessage}>
          <button type="button" className="emoji-btn" aria-label="Emoji" onClick={() => setPickerOpen(o => !o)}><Smile size={20}/></button>
          <input ref={inputRef} value={message} onChange={e => setMessage(e.target.value)} placeholder="Message likhein… (@ se mention)" maxLength="2000" enterKeyHint="send"/>
          <button className="send" disabled={!message.trim()} aria-label="Send message"><Send size={18}/></button>
        </form>
      </div>
    </section></main>}

    {profileOpen && view === 'chat' && <div className="modal-backdrop" onClick={() => setProfileOpen(false)}><div className="admin-modal glass profile-modal" onClick={e => e.stopPropagation()}>
      <button className="close" onClick={() => setProfileOpen(false)}>×</button>
      <div className="eyebrow"><span/> MERI PROFILE</div>
      <div className="dp-wrap">
        <Avatar name={me} url={profile?.avatar} cls="xl"/>
        <button type="button" className="dp-cam" aria-label="Photo badlein" disabled={dpBusy} onClick={() => fileRef.current?.click()}><Camera size={18}/></button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={changeDp}/>
      </div>
      <h2 className="center">{me}</h2>
      <p className="center">{dpBusy ? 'Photo upload ho rahi hai…' : 'Camera icon dabao aur apni photo (DP) lagao. Ye chat mein aapke naam ke saath dikhegi.'}</p>
      <div className="row2">
        <button className="secondary" disabled={dpBusy} onClick={() => fileRef.current?.click()}><Camera size={14}/> {profile?.avatar ? 'Photo badlein' : 'Photo lagayein'}</button>
        <button className="secondary" disabled={dpBusy || !profile?.avatar} onClick={removeDp}><Trash2 size={14}/> Photo hatayein</button>
      </div>
    </div></div>}

    {adminOpen && <div className="modal-backdrop" onClick={() => setAdminOpen(false)}><div className="admin-modal glass" onClick={e => e.stopPropagation()}>
      <button className="close" onClick={() => setAdminOpen(false)}>×</button>
      <div className="eyebrow"><span/> OWNER ACCESS</div>
      <h2>Owner console</h2>
      <p>Sirf room ka malik invitations, members aur unki email dekh sakta hai.</p>
      <label>Admin password</label>
      <input type="password" value={adminPass} onChange={e => setAdminPass(e.target.value)} placeholder="Apna admin password likhein"/>
      <button className="primary" onClick={makeCode} disabled={busy}><Plus size={17}/> GENERATE ONE-TIME CODE</button>
      {newCode && <div className="generated"><small>NEW ACTIVATION CODE</small><strong>{newCode}</strong><button onClick={() => copy(newCode)}><Copy size={15}/> Code copy karein</button></div>}
      <div className="row2"><button className="secondary" onClick={fetchCodes}>Code history</button><button className="secondary" onClick={fetchMembers}><Users size={14}/> Members dekhein</button></div>
      {owner && <div className="members-box"><div className="members-count"><b>{owner.count}</b><span>members</span></div>{owner.members.map(m => <div className="member-line" key={m.user_id}>
        <Avatar name={m.nickname} url={AVATAR_URL(m.user_id)} cls="sm"/>
        <span className="who"><b>{m.nickname}</b><small>{m.email || 'email nahi di'}</small></span>
        {m.email && <button className="mini-btn" title="Email copy karein" onClick={() => copy(m.email)}><Copy size={14}/></button>}
        <button className="rm-btn" title="Room se hatayein" onClick={() => removeMember(m)}><UserMinus size={15}/></button>
      </div>)}</div>}
      {codes.length > 0 && <div className="code-history">{codes.map((c, i) => <div key={i}><code>{c.code_hint}</code><span>{c.used_at ? 'USED' : 'AVAILABLE'}</span></div>)}</div>}
      {error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}
    </div></div>}

    {toast && <div className="toast glass">{toast}</div>}
  </div>;
}
export default App;
