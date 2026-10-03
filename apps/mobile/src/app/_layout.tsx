import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';
import { ThemeProvider, DarkTheme, DefaultTheme } from 'expo-router/react-navigation';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../session';
import { colors } from '../ui';

export default function Layout() {
  const dark = useColorScheme() === 'dark';
  const theme = dark ? DarkTheme : DefaultTheme;
  return <SessionProvider><ThemeProvider value={theme}><StatusBar style="auto" /><Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.accent, headerTitleStyle: { color: theme.colors.text }, headerLargeTitleStyle: { color: theme.colors.text }, contentStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
    <Stack.Screen name="index" options={{ title: 'Milagre', headerShown: false }} />
    <Stack.Screen name="projects" options={{ title: 'Projects', headerLargeTitleEnabled: true, headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerLargeStyle: { backgroundColor: 'transparent' }, headerLargeTitleShadowVisible: false }} />
    <Stack.Screen name="project" options={{ title: 'Chats', headerLargeTitleEnabled: true, headerTransparent: true, headerStyle: { backgroundColor: 'transparent' }, headerLargeStyle: { backgroundColor: 'transparent' }, headerLargeTitleShadowVisible: false }} />
    <Stack.Screen name="chat" options={{ title: 'Chat' }} />
    <Stack.Screen name="chat-details" options={{ title: 'Manage Chat' }} />
    <Stack.Screen name="new-worktree" options={{ title: 'New Worktree' }} />
    <Stack.Screen name="changes" options={{ title: 'Changes' }} />
    <Stack.Screen name="diff" options={{ title: 'Diff' }} />
  </Stack></ThemeProvider></SessionProvider>;
}
