import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useSession } from '../session';
import { Button, ErrorNotice, Field, PageScroll, styles } from '../ui';

export default function ConnectScreen() {
  const session = useSession();
  const [address, setAddress] = useState(process.env.EXPO_PUBLIC_DAEMON_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:8787' : 'http://127.0.0.1:8787'));
  const [token, setToken] = useState(process.env.EXPO_PUBLIC_DAEMON_TOKEN || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true); setError('');
    try { await session.connect(address, token); router.push('/projects'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <SafeAreaView style={styles.screen}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><PageScroll contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: 28 }}>
    <View style={{ gap: 16 }}><Image source={require('../../assets/milagre.png')} style={{ width: 54, height: 54, borderRadius: 14 }} /><Text style={styles.label}>MILAGRE / LOCAL PREVIEW</Text><Text style={[styles.title, { fontSize: 40 }]}>Your Chats.{"\n"}In your hand.</Text><Text style={styles.muted}>Connect to Milagre running on this Mac. Your agents keep working when you leave the app.</Text></View>
    <View style={styles.card}><Field label="Computer address" value={address} onChangeText={setAddress} keyboardType="url" /><Field label="Connection token" value={token} onChangeText={setToken} secureTextEntry /><Button title={busy ? 'Connecting...' : 'Connect to computer'} onPress={() => void connect()} disabled={busy || !token.trim()} /></View>
    {error ? <ErrorNotice message={error} /> : null}
    <Text style={styles.muted}>{process.env.EXPO_PUBLIC_DEMO === '1' ? 'Demo mode uses a temporary Project and a demo agent. No provider account is used.' : 'Local simulator preview. Start the daemon bridge and enter its connection token.'}</Text>
  </PageScroll></KeyboardAvoidingView></SafeAreaView>;
}
