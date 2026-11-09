import React, { useEffect, useRef, useState } from 'react';
import { supabase, configured } from './supabase';
import { ShieldCheck, LockKeyhole, MessageCircle, Users, Send, Copy, Plus, LogOut, Sparkles, KeyRound, Wifi, WifiOff } from 'lucide-react';

const ROOM = 'Shahzaib Room';
const edge = (name, body) => fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${supabase.auth.getSession ? '' : ''}` },
  body: JSON.stringify(body)
});

function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(() => JSON.parse(localStorage.getItem('sr-profile') || 'null'));
  const [view, setView] = useState('gate');
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [codes, setCodes] = useState([]);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const bottom = useRef(null);

  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (profile && session) setView('chat');
  }, [profile, session]);

  useEffect(() => {
    if (view !== 'chat' || !session) return;
    loadChat();
    const channel = supabase.channel('shahzaib-room-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        setMessages(prev => prev.some(m => m.id === payload.new.id) ? prev : [...prev, payload.new]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members' }, () => loadMembers())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [view, session]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function loadChat() {
    const [{ data: msgs }, { data: people }] = await Promise.all([
      supabase.from('messages').select('*').order('created_at').limit(150),
      supabase.from('room_members').select('user_id,nickname,last_seen').order('nickname')
    ]);
    setMessages(msgs || []); setMembers(people || []);
  }
  async function loadMembers() {
    const { data } = await supabase.from('room_members').select('user_id,nickname,last_seen').order('nickname');
    setMembers(data || []);
  }

  async function joinRoom(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (!configured) throw new Error('Pehle Supabase setup karein. README ki instructions follow karein.');
      if (!nickname.trim() || !code.trim()) throw new Error('Apna naam aur activation code enter karein.');
      let current = session;
      if (!current) {
        const { data, error: authError } = await supabase.auth.signInAnonymously();
        if (authError) throw authError;
        current = data.session;
      }
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/redeem-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${current.access_token}` },
        body: JSON.stringify({ code: code.trim(), nickname: nickname.trim().slice(0, 28) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Activation code accept nahi hua.');
      const p = { nickname: nickname.trim().slice(0,28) };
      localStorage.setItem('sr-profile', JSON.stringify(p)); setProfile(p); setView('chat'); setNotice('Welcome to Shahzaib Room.');
    } catch (err) { setError(err.message || 'Kuch ghalat ho gaya.'); }
    finally { setBusy(false); }
  }

  async function sendMessage(e) {
    e.preventDefault(); if (!message.trim() || !session) return;
    const body = message.trim().slice(0, 2000); setMessage('');
    const { error: sendError } = await supabase.from('messages').insert({ user_id: session.user.id, nickname: profile.nickname, body });
    if (sendError) { setError(sendError.message); setMessage(body); }
  }

  async function makeCode() {
    setError(''); setNotice(''); setBusy(true);
    try {
      const current = (await supabase.auth.getSession()).data.session;
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${current?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ admin_password: adminPass, action: 'create' })
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Code generate nahi hua.');
      setNewCode(data.code); setNotice('Naya one-time activation code generate ho gaya.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function fetchCodes() {
    setError('');
    try {
      const current = (await supabase.auth.getSession()).data.session;
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-codes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${current?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}` },
        body: JSON.stringify({ admin_password: adminPass, action: 'list' })
      });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Codes load nahi hue.');
      setCodes(data.codes || []);
    } catch (err) { setError(err.message); }
  }
  async function copy(text) { await navigator.clipboard.writeText(text); setNotice('Copied to clipboard.'); }
  async function leave() {
    localStorage.removeItem('sr-profile'); setProfile(null); setMessages([]); setView('gate');
    await supabase.auth.signOut();
  }

  if (!configured) return <main className="setup"><div className="setup-card"><Sparkles size={30}/><h1>Shahzaib Room</h1><h2>One quick setup required</h2><p>Supabase project credentials abhi configure nahi hain. ZIP ke <b>README.md</b> mein step-by-step setup aur SQL diya gaya hai. Vercel par deploy karne se pehle environment variables add karein.</p><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</code></div></main>;

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-icon"><MessageCircle size={20}/></span><span>SHAHZAIB<span className="brand-light"> ROOM</span></span></a><div className="top-right"><span className="secure"><span/> PRIVATE SPACE</span><button className="icon-btn" title="Admin" onClick={() => {setAdminOpen(!adminOpen);setError('');}}><ShieldCheck size={18}/></button>{view === 'chat' && <button className="icon-btn" title="Leave room" onClick={leave}><LogOut size={18}/></button>}</div></header>
    {view === 'gate' ? <main className="gate-wrap"><div className="gate-card"><div className="orb"><LockKeyhole size={28}/></div><div className="eyebrow"><span/> INVITATION ONLY</div><h1>You're one code<br/><em>away from the room.</em></h1><p className="sub">A private space for conversations that matter. Enter your personal invitation code to continue.</p><form onSubmit={joinRoom} className="gate-form"><label>Your display name</label><input value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="e.g. Shahzaib" maxLength="28" required/><label>Activation code</label><div className="code-input"><KeyRound size={18}/><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="ENTER YOUR CODE" autoCapitalize="characters" required/></div><button className="primary" disabled={busy}>{busy?'VERIFYING…':'ENTER SHAHZAIB ROOM'} <span>↗</span></button></form>{error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}<div className="gate-foot"><ShieldCheck size={15}/> Your invitation is private and single-use.</div></div><div className="gate-side"><div className="side-grid"/><div className="side-content"><span className="side-tag">A PRIVATE COMMUNITY</span><h2>Good conversations<br/>start <em>here.</em></h2><p>Thoughtful people. Real-time conversations. One shared space.</p><div className="mini-stats"><div><b>01</b><small>PRIVATE ROOM</small></div><div><b>∞</b><small>LIVE MESSAGES</small></div><div><b>24/7</b><small>CONNECTED</small></div></div></div><div className="side-bottom">DESIGNED FOR CONNECTION <span>✳</span></div></div></main> :
    <main className="chat-layout"><aside className="sidebar"><div className="room-label">YOUR SPACE</div><div className="room-item active"><span className="room-avatar">S</span><span><b>Shahzaib Room</b><small>Private group</small></span><i/></div><div className="members-head"><span>MEMBERS</span><b>{members.length}</b></div><div className="member-list">{members.map(m=><div className="member" key={m.user_id}><span className="member-avatar">{m.nickname?.[0]?.toUpperCase()||'?'}</span><span>{m.nickname}</span><i/></div>)}</div><div className="sidebar-bottom"><div className="avatar-me">{profile?.nickname?.[0]?.toUpperCase()}</div><span><b>{profile?.nickname}</b><small>In the room</small></span></div></aside><section className="chat-main"><div className="chat-head"><div><div className="room-label">LIVE CONVERSATION</div><h2>Shahzaib Room <span className="live-pill"><i/> LIVE</span></h2></div><div className="online"><Users size={16}/>{members.length} members</div></div><div className="messages">{messages.length===0?<div className="empty"><div className="empty-icon"><MessageCircle size={26}/></div><h3>The room is yours.</h3><p>Start the conversation. Your message will appear here in real time.</p></div>:messages.map(m=><div className={`message-row ${m.user_id===session?.user?.id?'mine':''}`} key={m.id}><div className="message-avatar">{m.nickname?.[0]?.toUpperCase()}</div><div className="message-content"><div className="message-meta"><b>{m.nickname}</b><time>{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time></div><div className="bubble">{m.body}</div></div></div>)}<div ref={bottom}/></div><form className="composer" onSubmit={sendMessage}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write a message…" maxLength="2000"/><span className="composer-hint">ENTER TO SEND</span><button disabled={!message.trim()} aria-label="Send message"><Send size={18}/></button></form></section></main>}
    {adminOpen && <div className="modal-backdrop" onClick={()=>setAdminOpen(false)}><div className="admin-modal" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setAdminOpen(false)}>×</button><div className="eyebrow"><span/> OWNER ACCESS</div><h2>Admin console</h2><p>Only the room owner can generate invitations.</p><label>Admin password</label><input type="password" value={adminPass} onChange={e=>setAdminPass(e.target.value)} placeholder="Enter your admin password"/><button className="primary" onClick={makeCode} disabled={busy}><Plus size={17}/> GENERATE ONE-TIME CODE</button>{newCode && <div className="generated"><small>NEW ACTIVATION CODE</small><strong>{newCode}</strong><button onClick={()=>copy(newCode)}><Copy size={15}/> Copy code</button></div>}<button className="secondary" onClick={fetchCodes}>View code history</button>{codes.length>0 && <div className="code-history">{codes.map((c,i)=><div key={i}><code>{c.code_hint}</code><span>{c.used_at?'USED':'AVAILABLE'}</span></div>)}</div>}{error && <p className="error">{error}</p>}{notice && <p className="success">{notice}</p>}</div></div>}
    <footer className="footer">SHAHZAIB ROOM <span>•</span> PRIVATE BY INVITATION</footer>
  </div>;
}
export default App;