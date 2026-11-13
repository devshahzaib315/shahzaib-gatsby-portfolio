import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';

export default function HomeScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn() {
    setLoading(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setMessage(error ? error.message : 'Signed in successfully. Chat screens are the next build milestone.');
    setLoading(false);
  }

  async function signOut() { await supabase.auth.signOut({ scope: 'local' }); }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.glow} />
        <View style={styles.brandMark}><Text style={styles.brandInitial}>S</Text></View>
        <Text style={styles.brand}>SHAHZAIB-ROOM</Text>
        <Text style={styles.tagline}>Your space. Your people.</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>{signedIn ? 'You are signed in' : 'Welcome back'}</Text>
          <Text style={styles.subheading}>{signedIn ? 'Your account is connected to Shahzaib Room.' : 'Sign in to continue to your room.'}</Text>
          {signedIn ? <Pressable style={styles.button} onPress={signOut}><Text style={styles.buttonText}>Sign Out</Text></Pressable> : <>
            <Text style={styles.label}>Email</Text>
            <TextInput value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor="#b18b9d" autoCapitalize="none" keyboardType="email-address" style={styles.input} />
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordWrap}><TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#b18b9d" secureTextEntry={!showPassword} autoCapitalize="none" style={styles.passwordInput} /><Pressable onPress={() => setShowPassword(v => !v)}><Text style={styles.show}>{showPassword ? 'HIDE' : 'SHOW'}</Text></Pressable></View>
            <Pressable style={[styles.button, loading && styles.disabled]} onPress={signIn} disabled={loading || !email || !password}>{loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}</Pressable>
          </>}
          {!!message && <Text style={styles.message}>{message}</Text>}
        </View>
        <Text style={styles.footer}>Powered by one shared Supabase backend</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#fff5fa'}, container:{flex:1,justifyContent:'center',paddingHorizontal:24,alignItems:'center',overflow:'hidden'},
  glow:{position:'absolute',top:'12%',width:300,height:300,borderRadius:150,backgroundColor:'#f9d5e5',opacity:.65},
  brandMark:{width:76,height:76,borderRadius:26,alignItems:'center',justifyContent:'center',backgroundColor:'#d66b9b',shadowColor:'#b54c7e',shadowOpacity:.25,shadowRadius:20,elevation:8},
  brandInitial:{fontSize:42,fontWeight:'800',color:'#fff'},brand:{marginTop:18,fontSize:23,fontWeight:'900',letterSpacing:2,color:'#602b46'},tagline:{marginTop:6,marginBottom:30,color:'#a57990',fontSize:13},
  card:{width:'100%',maxWidth:430,padding:23,borderRadius:28,backgroundColor:'rgba(255,255,255,.94)',borderWidth:1,borderColor:'#f3d6e3',shadowColor:'#9c5275',shadowOpacity:.12,shadowRadius:24,elevation:5},
  heading:{fontSize:23,fontWeight:'800',color:'#5b2a43'},subheading:{marginTop:6,marginBottom:22,color:'#a27b8f',fontSize:13},label:{fontSize:12,fontWeight:'700',color:'#75445d',marginBottom:7,marginTop:12},
  input:{height:50,borderWidth:1,borderColor:'#f0d5e1',borderRadius:14,paddingHorizontal:14,color:'#51263e',backgroundColor:'#fffafd'},passwordWrap:{height:50,borderWidth:1,borderColor:'#f0d5e1',borderRadius:14,paddingHorizontal:14,flexDirection:'row',alignItems:'center',backgroundColor:'#fffafd'},passwordInput:{flex:1,color:'#51263e'},show:{fontSize:10,fontWeight:'800',color:'#c15c8b',letterSpacing:1},
  button:{height:52,borderRadius:15,backgroundColor:'#cf6596',alignItems:'center',justifyContent:'center',marginTop:22,shadowColor:'#b54c7e',shadowOpacity:.2,shadowRadius:10,elevation:3},buttonText:{fontSize:15,fontWeight:'800',color:'#fff'},disabled:{opacity:.5},message:{marginTop:15,color:'#87526d',fontSize:12},footer:{marginTop:25,color:'#b18b9d',fontSize:11}
});
