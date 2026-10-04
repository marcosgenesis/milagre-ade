import { useState } from 'react';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SessionProvider, useSession } from '../session';
import { PushProvider } from '../push';
import { StartupSplash } from '../startup-splash';
import { hex } from '../theme';

export default function Layout() {
  const scheme = useColorScheme();
  const palette = hex(scheme);
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: palette.accent, background: palette.page, card: palette.page, text: palette.ink, border: palette.line } };
  // Titles sit inline in a transparent top bar; content blurs softly as it scrolls under it (iOS 26 scroll edge effect).
  const sheet = { presentation: 'formSheet', sheetGrabberVisible: true, sheetCornerRadius: 28, headerShown: false, contentStyle: { backgroundColor: palette.page } } as const;
  return <GestureHandlerRootView style={{ flex: 1 }}><KeyboardProvider><SessionProvider><PushProvider><ThemeProvider value={theme}><StatusBar style="auto" /><Stack screenOptions={{ headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, scrollEdgeEffects: { top: 'soft' }, headerTintColor: palette.ink, headerTitleStyle: { color: palette.ink, fontWeight: '600', fontSize: 17 }, contentStyle: { backgroundColor: palette.page }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
    <Stack.Screen name="index" options={{ title: 'Computers' }} />
    <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
    <Stack.Screen name="add-computer" options={{ ...sheet, sheetAllowedDetents: [1] }} />
    <Stack.Screen name="pair" options={{ title: 'Pairing' }} />
    <Stack.Screen name="projects" options={{ title: 'Projects' }} />
    <Stack.Screen name="project" options={{ title: 'Chats' }} />
    <Stack.Screen name="chat" options={{ title: 'Chat' }} />
    <Stack.Screen name="permission-sheet" options={{ ...sheet, sheetAllowedDetents: [0.42, 0.6], sheetInitialDetentIndex: 0 }} />
    <Stack.Screen name="model-sheet" options={{ ...sheet, sheetAllowedDetents: [0.55, 1], sheetInitialDetentIndex: 0 }} />
    <Stack.Screen name="agents" options={{ ...sheet, sheetAllowedDetents: [0.5, 1], sheetInitialDetentIndex: 0 }} />
    <Stack.Screen name="activity" options={{ ...sheet, sheetAllowedDetents: [0.5, 1] }} />
    <Stack.Screen name="viewer" options={{ presentation: 'transparentModal', headerShown: false, animation: 'none', contentStyle: { backgroundColor: 'transparent' } }} />
    <Stack.Screen name="chat-details" options={{ title: 'Rename Chat' }} />
    <Stack.Screen name="new-worktree" options={{ title: 'New Worktree' }} />
    <Stack.Screen name="changes" options={{ title: 'Changes' }} />
    <Stack.Screen name="diff" options={{ title: 'Diff' }} />
  </Stack><Splash /></ThemeProvider></PushProvider></SessionProvider></KeyboardProvider></GestureHandlerRootView>;
}

function Splash() {
  const session = useSession();
  const [shown, setShown] = useState(true);
  return shown ? <StartupSplash ready={session.booted} onDone={() => setShown(false)} /> : null;
}
