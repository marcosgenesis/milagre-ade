import { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSession } from '../session';
import { savedConnection } from '../connection-native';
import { Button, Choice, ErrorNotice, Field, PageScroll, styles } from '../ui';

export default function ConnectScreen() {
  const session = useSession();
  const [address, setAddress] = useState(process.env.EXPO_PUBLIC_DAEMON_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://127.0.0.1:8787'));
  const [token, setToken] = useState(process.env.EXPO_PUBLIC_DAEMON_TOKEN || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [hasSaved, setHasSaved] = useState(false);
  const edited = useRef(false);
  const demo = process.env.EXPO_PUBLIC_DEMO === '1';
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    savedConnection.load().then(connection => {
      if (cancelled || edited.current || !connection) return;
      setAddress(connection.address); setToken(connection.token); setHasSaved(true);
    }).catch(e => { if (!cancelled) { setError(e.message); setHasSaved(true); } });
    return () => { cancelled = true; };
  }, [demo]);
  async function connect() {
    edited.current = true;
    setBusy(true); setError('');
    try { if (await session.connect(address, token, remember)) { setHasSaved(remember && !demo); router.push('/projects'); } }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function forget() {
    edited.current = true;
    session.disconnect(); setBusy(true); setError('');
    try { await savedConnection.forget(); setToken(''); setHasSaved(false); }
    catch { setError('Could not forget this computer. Try again before leaving the app.'); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.screen}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><PageScroll contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 28 }}>
    <View style={{ gap: 16 }}><Image source={require('../../assets/milagre.png')} style={{ width: 54, height: 54, borderRadius: 14 }} /><Text style={styles.label}>MILAGRE / YOUR COMPUTER</Text><Text style={[styles.title, { fontSize: 40 }]}>Your Chats.{"\n"}In your hand.</Text><Text style={styles.muted}>Connect to your computer. Your agents keep working when you leave the app.</Text></View>
    <View style={styles.card}><Field label="Computer address" value={address} onChangeText={value => { edited.current = true; setAddress(value); }} keyboardType="url" /><Field label="Connection token" value={token} onChangeText={value => { edited.current = true; setToken(value); }} autoComplete="off" textContentType="none" importantForAutofill="no" secureTextEntry />{!demo && <Choice title="Remember this computer" selected={remember} onPress={() => setRemember(!remember)} />}<Button title={busy ? 'Connecting...' : 'Connect to computer'} onPress={() => void connect()} disabled={busy || !token.trim()} />{hasSaved && <Button title="Forget this computer" secondary disabled={busy} onPress={() => void forget()} />}</View>
    {error ? <ErrorNotice message={error} /> : null}
    <Text style={styles.muted}>{demo ? 'Demo mode uses a temporary Project and a demo agent. No provider account is used.' : 'Use the address and connection token from your Milagre host. Remote connections need HTTPS.'}</Text>
  </PageScroll></KeyboardAvoidingView></SafeAreaView>;
}
