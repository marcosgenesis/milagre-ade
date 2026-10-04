import { useCallback, useEffect } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Redirect, Stack, router, useLocalSearchParams, type Href } from 'expo-router';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSession } from '../session';
import { ProjectNavigation } from '../project-navigation';
import { colors } from '../theme';

/** A route keeps native modal accessibility and Android Back, without another native dependency. */
export default function NavigationDrawer() {
  const session = useSession();
  const { chatId } = useLocalSearchParams<{ chatId?: string }>();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(380, width - 32);
  const progress = useSharedValue(0);
  const from = useSharedValue(0);
  const closing = useSharedValue(false);
  const { cancelNavigation } = session;
  const finish = useCallback((href?: Href, secondary = false) => {
    if (href && !secondary) { router.dismissAll(); router.replace(href); }
    else { router.back(); if (href) router.push(href); }
  }, []);
  const close = useCallback((href?: Href, secondary = false) => {
    if (closing.get()) return;
    closing.set(true);
    Keyboard.dismiss();
    // A dismissed pending open must never select its Project after the drawer is gone.
    cancelNavigation();
    progress.set(withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }, done => { if (done) scheduleOnRN(finish, href, secondary); }));
  }, [finish, progress, cancelNavigation, closing]);
  useEffect(() => {
    Keyboard.dismiss();
    progress.set(withTiming(1, { duration: 240, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }));
    const back = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => back.remove();
  }, [close, progress]);
  const panel = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.get() - 1) * drawerWidth }] }));
  const shade = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const pan = Gesture.Pan().activeOffsetX([-16, 1e5]).failOffsetY([-12, 12])
    .onStart(() => { from.set(progress.get()); })
    .onUpdate(event => { progress.set(Math.max(0, Math.min(1, from.get() + event.translationX / drawerWidth))); })
    .onEnd(event => {
      if (event.velocityX < -500 || progress.get() < 0.65) scheduleOnRN(close);
      else progress.set(withSpring(1, { damping: 32, stiffness: 320, mass: 0.9, reduceMotion: ReduceMotion.System }));
    });
  if (!session.client) return <Redirect href="/" />;
  return <GestureHandlerRootView style={{ flex: 1 }} accessibilityViewIsModal>
    <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
    <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.backdrop }, shade]}><Pressable accessibilityRole="button" accessibilityLabel="Close navigation" onPress={() => close()} style={StyleSheet.absoluteFill} /></Animated.View>
    <GestureDetector gesture={pan}><Animated.View style={[{ width: drawerWidth, flex: 1, backgroundColor: colors.page, borderRightWidth: StyleSheet.hairlineWidth, borderColor: colors.line }, panel]}>
      <ProjectNavigation key={session.client.url} activeChatId={chatId ? Number(chatId) : undefined} onClose={() => close()} onNavigate={close} />
    </Animated.View></GestureDetector>
  </GestureHandlerRootView>;
}
