import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../session';
import { hex } from '../theme';

export default function Layout() {
  const scheme = useColorScheme();
  const palette = hex(scheme);
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: palette.accent, background: palette.page, card: palette.page, text: palette.ink, border: palette.line } };
  // Titles sit inline in the top bar; the system draws iOS's round glass bar buttons around header items.
  const sheet = { presentation: 'formSheet', sheetGrabberVisible: true, sheetCornerRadius: 28, headerShown: false, contentStyle: { backgroundColor: palette.page } } as const;
  return <SessionProvider><ThemeProvider value={theme}><StatusBar style="auto" /><Stack screenOptions={{ headerStyle: { backgroundColor: palette.page }, headerTintColor: palette.ink, headerTitleStyle: { color: palette.ink, fontWeight: '600', fontSize: 17 }, contentStyle: { backgroundColor: palette.page }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
    <Stack.Screen name="index" options={{ title: 'Computers' }} />
    <Stack.Screen name="add-computer" options={{ ...sheet, sheetAllowedDetents: [1] }} />
    <Stack.Screen name="pair" options={{ title: 'Pairing' }} />
    <Stack.Screen name="projects" options={{ title: 'Projects' }} />
    <Stack.Screen name="project" options={{ title: 'Chats' }} />
    <Stack.Screen name="chat" options={{ title: 'Chat' }} />
    <Stack.Screen name="model-sheet" options={{ ...sheet, sheetAllowedDetents: [0.55, 1], sheetInitialDetentIndex: 0 }} />
    <Stack.Screen name="agents" options={{ ...sheet, sheetAllowedDetents: [0.5, 1] }} />
    <Stack.Screen name="viewer" options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
    <Stack.Screen name="chat-details" options={{ title: 'Rename Chat' }} />
    <Stack.Screen name="new-worktree" options={{ title: 'New Worktree' }} />
    <Stack.Screen name="changes" options={{ title: 'Changes' }} />
    <Stack.Screen name="diff" options={{ title: 'Diff' }} />
  </Stack></ThemeProvider></SessionProvider>;
}
