import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type Message = {
  id: number; user_id: string; nickname: string; body: string; created_at: string;
  edited_at?: string | null; reply_to_id?: number | null; reply_to_body?: string | null;
  reply_to_nickname?: string | null;
};
type Member = { user_id: string; nickname: string; is_banned?: boolean };

const PINK = '#cf6596';
const REACTIONS = ['❤️','😂','👍','😮','😢','🔥','👏','🎉','🙏','😍','😡','💯'];

export default function HomeScreen() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [nickname, setNickname] = useState('Member');
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState<Message | null>(null);
  const [reactionFor, setReactionFor] = useState<number | null>(null);
  const [reactions, setReactions] = useState<Record<number, string[]>>({});
  const listRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadRoom = useCallback(async (userId: string) => {
    const [memberRes, messageRes, reactionRes] = await Promise.all([
      supabase.from('room_members').select('nickname,is_banned').eq('user_id', userId).maybeSingle(),
      supabase.from('messages').select('id,user_id,nickname,body,created_at,edited_at,reply_to_id,reply_to_body,reply_to_nickname').order('created_at', { ascending: true }).limit(150),
      supabase.from('message_reactions').select('message_id,reaction').limit(1000),
    ]);
    if (memberRes.data?.is_banned) {
      await supabase.auth.signOut();
      setError('This account is currently restricted from the room.');
      return;
    }
    setNickname(memberRes.data?.nickname || 'Member');
    if (messageRes.error) setError(messageRes.error.message);
    else setMessages((messageRes.data || []) as Message[]);
    const grouped: Record<number, string[]> = {};
    (reactionRes.data || []).forEach((item: any) => { grouped[item.message_id] ||= []; grouped[item.message_id].push(item.reaction); });
    setReactions(grouped);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 180);
  }, []);

  useEffect(() => {
    if (!session?.user.id) return;
    loadRoom(session.user.id);
    const channel = supabase.channel('native-room-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => loadRoom(session.user.id))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => loadRoom(session.user.id))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user.id, loadRoom]);

  async function signIn() {
    setBusy(true); setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) setError(authError.message);
    setBusy(false);
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || !session?.user.id) return;
    setBusy(true); setError('');
    const { error: sendError } = await supabase.from('messages').insert({
      user_id: session.user.id, nickname, body, message_type: 'text',
      ...(reply ? { reply_to_id: reply.id, reply_to_body: reply.body, reply_to_nickname: reply.nickname, reply_to_type: 'text' } : {}),
    });
    if (sendError) setError(sendError.message);
    else { setDraft(''); setReply(null); await loadRoom(session.user.id); }
    setBusy(false);
  }

  async function addReaction(messageId: number, reaction: string) {
    if (!session?.user.id) return;
    const { data: existing } = await supabase.from('message_reactions').select('id').eq('message_id', messageId).eq('user_id', session.user.id).eq('reaction', reaction).maybeSingle();
    if (existing?.id) await supabase.from('message_reactions').delete().eq('id', existing.id);
    else await supabase.from('message_reactions').insert({ message_id: messageId, user_id: session.user.id, reaction });
    setReactionFor(null);
    await loadRoom(session.user.id);
  }

  async function deleteOwnMessage(message: Message) {
    if (!session?.user.id || message.user_id !== session.user.id) return;
    const { error: deleteError } = await supabase.from('messages').delete().eq('id', message.id).eq('user_id', session.user.id);
    if (deleteError) setError(deleteError.message);
    else await loadRoom(session.user.id);
  }

  if (loading) return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={PINK} /></View></SafeAreaView>;

  if (!session) return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.loginWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.logo}><Text style={styles.logoText}>S</Text></View>
        <Text style={styles.brand}>SHAHZAIB-ROOM</Text><Text style={styles.tagline}>Your space. Your people.</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>Welcome back</Text><Text style={styles.subheading}>Sign in to enter the room</Text>
          <Text style={styles.label}>Email</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor="#b18b9d" autoCapitalize="none" keyboardType="email-address" style={styles.input} />
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordWrap}><TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#b18b9d" secureTextEntry={!showPassword} autoCapitalize="none" style={styles.passwordInput} /><Pressable onPress={() => setShowPassword(v => !v)}><Text style={styles.show}>{showPassword ? 'HIDE' : 'SHOW'}</Text></Pressable></View>
          <Pressable style={[styles.button, (!email || !password || busy) && styles.disabled]} onPress={signIn} disabled={!email || !password || busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}</Pressable>
          {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
        <Text style={styles.footer}>One room. One shared community.</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.chat} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <View style={styles.header}>
          <View style={styles.headerLogo}><Text style={styles.headerLogoText}>S</Text></View>
          <View style={{flex:1}}><Text style={styles.headerTitle}>SHAHZAIB-ROOM</Text><Text style={styles.headerSub}>Shared community chat</Text></View>
          <Pressable onPress={() => supabase.auth.signOut()} style={styles.logout}><Text style={styles.logoutText}>EXIT</Text></Pressable>
        </View>
        <View style={styles.roomBanner}><Text style={styles.roomBannerTitle}>The Room</Text><Text style={styles.roomBannerSub}>Welcome, {nickname}</Text></View>
        <FlatList ref={listRef} data={messages} keyExtractor={item => String(item.id)} contentContainerStyle={styles.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyEmoji}>💗</Text><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.emptySub}>Your messages will appear here.</Text></View>}
          renderItem={({item}) => {
            const mine = item.user_id === session.user.id;
            const rowReactions = reactions[item.id] || [];
            return <View style={[styles.messageRow, mine && styles.myMessageRow]}>
              <Pressable onLongPress={() => setReactionFor(reactionFor === item.id ? null : item.id)} delayLongPress={350} onPress={() => setReply(item)} style={[styles.bubble, mine ? styles.myBubble : styles.otherBubble]}>
                {!mine && <Text style={styles.sender}>{item.nickname}</Text>}
                {item.reply_to_body ? <View style={styles.replyQuote}><Text style={styles.replyName}>{item.reply_to_nickname || 'Reply'}</Text><Text numberOfLines={2} style={styles.replyText}>{item.reply_to_body}</Text></View> : null}
                <Text style={[styles.body, mine && styles.myBody]}>{item.body}</Text>
                <Text style={[styles.time, mine && styles.myTime]}>{new Date(item.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}{item.edited_at ? ' · edited' : ''}</Text>
              </Pressable>
              <View style={styles.messageActions}>
                <Pressable onPress={() => setReactionFor(reactionFor === item.id ? null : item.id)}><Text style={styles.actionText}>☺</Text></Pressable>
                {mine && <Pressable onPress={() => deleteOwnMessage(item)}><Text style={styles.deleteText}>Delete</Text></Pressable>}
              </View>
              {rowReactions.length > 0 && <View style={styles.reactionPills}>{REACTIONS.filter(r => rowReactions.includes(r)).map(r => <Text key={r} style={styles.reactionPill}>{r} {rowReactions.filter(x => x === r).length}</Text>)}</View>}
              {reactionFor === item.id && <View style={styles.reactionPicker}>{REACTIONS.map(r => <Pressable key={r} onPress={() => addReaction(item.id,r)} style={styles.reactionChoice}><Text style={{fontSize:22}}>{r}</Text></Pressable>)}</View>}
            </View>;
          }}
        />
        {reply && <View style={styles.replyBar}><View style={{flex:1}}><Text style={styles.replyName}>Replying to {reply.nickname}</Text><Text numberOfLines={1} style={styles.replyText}>{reply.body}</Text></View><Pressable onPress={() => setReply(null)}><Text style={styles.cancelReply}>✕</Text></Pressable></View>}
        {!!error && <Text style={styles.inlineError}>{error}</Text>}
        <View style={styles.composer}><TextInput value={draft} onChangeText={setDraft} placeholder="Write a message..." placeholderTextColor="#b18b9d" multiline maxLength={2000} style={styles.composerInput} /><Pressable onPress={sendMessage} disabled={!draft.trim() || busy} style={[styles.sendButton, (!draft.trim() || busy) && styles.disabled]}><Text style={styles.sendText}>➤</Text></Pressable></View>
        <Text style={styles.hint}>Hold a message for reactions · Tap to reply</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#fff5fa'}, center:{flex:1,alignItems:'center',justifyContent:'center'},
  loginWrap:{flex:1,justifyContent:'center',paddingHorizontal:24,alignItems:'center',overflow:'hidden'},
  logo:{width:76,height:76,borderRadius:26,alignItems:'center',justifyContent:'center',backgroundColor:'#d66b9b',shadowColor:'#b54c7e',shadowOpacity:.25,shadowRadius:20,elevation:8},
  logoText:{fontSize:42,fontWeight:'800',color:'#fff'},brand:{marginTop:18,fontSize:23,fontWeight:'900',letterSpacing:2,color:'#602b46'},tagline:{marginTop:6,marginBottom:30,color:'#a57990',fontSize:13},
  card:{width:'100%',maxWidth:430,padding:23,borderRadius:28,backgroundColor:'#fff',borderWidth:1,borderColor:'#f3d6e3',shadowColor:'#9c5275',shadowOpacity:.12,shadowRadius:24,elevation:5},
  heading:{fontSize:23,fontWeight:'800',color:'#5b2a43'},subheading:{marginTop:6,marginBottom:22,color:'#a27b8f',fontSize:13},label:{fontSize:12,fontWeight:'700',color:'#75445d',marginBottom:7,marginTop:12},
  input:{height:50,borderWidth:1,borderColor:'#f0d5e1',borderRadius:14,paddingHorizontal:14,color:'#51263e',backgroundColor:'#fffafd'},passwordWrap:{height:50,borderWidth:1,borderColor:'#f0d5e1',borderRadius:14,paddingHorizontal:14,flexDirection:'row',alignItems:'center',backgroundColor:'#fffafd'},passwordInput:{flex:1,color:'#51263e'},show:{fontSize:10,fontWeight:'800',color:'#c15c8b',letterSpacing:1},
  button:{height:52,borderRadius:15,backgroundColor:PINK,alignItems:'center',justifyContent:'center',marginTop:22},buttonText:{fontSize:15,fontWeight:'800',color:'#fff'},disabled:{opacity:.5},error:{marginTop:14,color:'#bd3f69',fontSize:12},footer:{marginTop:25,color:'#b18b9d',fontSize:11},
  chat:{flex:1,backgroundColor:'#fff5fa'},header:{height:66,backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:'#f3dce6',paddingHorizontal:16,flexDirection:'row',alignItems:'center',gap:11},
  headerLogo:{width:40,height:40,borderRadius:14,backgroundColor:PINK,alignItems:'center',justifyContent:'center'},headerLogoText:{color:'#fff',fontSize:23,fontWeight:'900'},headerTitle:{fontSize:14,fontWeight:'900',letterSpacing:1,color:'#602b46'},headerSub:{fontSize:10,color:'#a57990',marginTop:2},logout:{paddingHorizontal:13,paddingVertical:9,borderRadius:12,backgroundColor:'#fff0f6'},logoutText:{fontSize:10,fontWeight:'900',color:PINK,letterSpacing:1},
  roomBanner:{margin:14,padding:15,borderRadius:18,backgroundColor:'#f9e1ec',borderWidth:1,borderColor:'#f1c9da'},roomBannerTitle:{fontSize:16,fontWeight:'900',color:'#6b304d'},roomBannerSub:{fontSize:11,color:'#a36c86',marginTop:3},
  messageList:{paddingHorizontal:14,paddingBottom:18,flexGrow:1},messageRow:{maxWidth:'88%',alignSelf:'flex-start',marginBottom:12},myMessageRow:{alignSelf:'flex-end'},bubble:{padding:12,borderRadius:18,minWidth:110},myBubble:{backgroundColor:'#cf6596',borderBottomRightRadius:5},otherBubble:{backgroundColor:'#fff',borderWidth:1,borderColor:'#f1dce6',borderBottomLeftRadius:5},sender:{fontSize:10,fontWeight:'900',color:PINK,marginBottom:5},body:{fontSize:14,lineHeight:20,color:'#5c3549'},myBody:{color:'#fff'},time:{fontSize:9,color:'#b18b9d',alignSelf:'flex-end',marginTop:5},myTime:{color:'#ffe5f0'},
  messageActions:{flexDirection:'row',gap:12,alignItems:'center',paddingHorizontal:7,paddingTop:3},actionText:{fontSize:18,color:'#b87a96'},deleteText:{fontSize:10,color:'#b87a96'},reactionPills:{flexDirection:'row',flexWrap:'wrap',gap:4,marginTop:4},reactionPill:{backgroundColor:'#fff',borderRadius:12,paddingHorizontal:7,paddingVertical:3,fontSize:11,color:'#75445d',overflow:'hidden'},reactionPicker:{flexDirection:'row',flexWrap:'wrap',width:224,backgroundColor:'#fff',borderRadius:16,padding:7,marginTop:5,borderWidth:1,borderColor:'#f1dce6'},reactionChoice:{width:'25%',height:42,alignItems:'center',justifyContent:'center'},
  empty:{alignItems:'center',justifyContent:'center',paddingVertical:60},emptyEmoji:{fontSize:34},emptyTitle:{fontSize:16,fontWeight:'800',color:'#75445d',marginTop:12},emptySub:{fontSize:12,color:'#b18b9d',marginTop:5},
  replyQuote:{borderLeftWidth:3,borderLeftColor:'#f0b1cd',paddingLeft:8,marginBottom:8},replyName:{fontSize:10,fontWeight:'900',color:PINK},replyText:{fontSize:11,color:'#9b7186',marginTop:2},replyBar:{marginHorizontal:12,marginBottom:6,padding:10,borderRadius:12,backgroundColor:'#f9e1ec',flexDirection:'row',alignItems:'center'},cancelReply:{fontSize:18,color:PINK,paddingHorizontal:8},
  composer:{flexDirection:'row',alignItems:'flex-end',gap:8,paddingHorizontal:12,paddingVertical:10,backgroundColor:'#fff',borderTopWidth:1,borderTopColor:'#f3dce6'},composerInput:{flex:1,minHeight:44,maxHeight:110,borderRadius:16,backgroundColor:'#fff5fa',paddingHorizontal:14,paddingVertical:11,color:'#5c3549',fontSize:14},sendButton:{width:44,height:44,borderRadius:15,backgroundColor:PINK,alignItems:'center',justifyContent:'center'},sendText:{fontSize:21,color:'#fff'},hint:{textAlign:'center',fontSize:9,color:'#b18b9d',paddingBottom:5},inlineError:{color:'#bd3f69',fontSize:11,paddingHorizontal:15,paddingBottom:4}
});
