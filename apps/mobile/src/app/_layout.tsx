import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../session';
import { colors } from '../ui';

export default function Layout() {
  return <SessionProvider><StatusBar style="light" /><Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
    <Stack.Screen name="index" options={{ title: 'Milagre', headerShown: false }} />
    <Stack.Screen name="projects" options={{ title: 'Your computer' }} />
    <Stack.Screen name="project" options={{ title: 'Chats' }} />
    <Stack.Screen name="chat" options={{ title: 'Chat' }} />
    <Stack.Screen name="chat-details" options={{ title: 'Manage Chat' }} />
    <Stack.Screen name="new-worktree" options={{ title: 'New Worktree' }} />
    <Stack.Screen name="changes" options={{ title: 'Changes' }} />
    <Stack.Screen name="diff" options={{ title: 'Diff' }} />
  </Stack></SessionProvider>;
}
