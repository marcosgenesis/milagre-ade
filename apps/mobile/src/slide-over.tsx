import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { colors } from './theme';

const SPRING = { damping: 32, stiffness: 320, mass: 0.9 };
// Points a finger travels sideways before the drag takes over, and up or down before it gives way to scrolling.
const SLOP_X = 16;
const SLOP_Y = 14;
const FLICK = 500;

/**
 * Paseo's file explorer on a phone: a page that slides in from the right over the screen. A leftward drag anywhere
 * pulls it in under the finger and it stays open past a third of the width or on a flick; a rightward drag puts it back.
 * `open` follows the settled state, so a parent can open it from a button too.
 */
export function SlideOver({ open, onOpenChange, onPull, panel, children, enabled = true }: { open: boolean; onOpenChange: (open: boolean) => void; onPull?: () => void; panel: React.ReactNode; children: React.ReactNode; enabled?: boolean }) {
  const { width } = useWindowDimensions();
  const progress = useSharedValue(open ? 1 : 0);
  const from = useSharedValue(0);
  useEffect(() => { progress.set(withSpring(open ? 1 : 0, SPRING)); }, [open, progress]);
  // Closed, only a leftward drag starts it; open, only a rightward one. The other direction keeps the screen's own
  // gestures, the back swipe among them.
  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(open ? [-1e5, SLOP_X] : [-SLOP_X, 1e5])
    .failOffsetY([-SLOP_Y, SLOP_Y])
    .onStart(() => {
      from.set(progress.get());
      if (onPull) scheduleOnRN(onPull);
    })
    .onUpdate(event => { progress.set(Math.min(1, Math.max(0, from.get() - event.translationX / width))); })
    .onEnd(event => {
      const next = event.velocityX < -FLICK ? true : event.velocityX > FLICK ? false : from.get() ? progress.get() > 2 / 3 : progress.get() > 1 / 3;
      progress.set(withSpring(next ? 1 : 0, SPRING));
      scheduleOnRN(onOpenChange, next);
    });
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - progress.get()) * width }] }));
  const shade = useAnimatedStyle(() => ({ opacity: progress.get() * 0.3 }));
  return <GestureDetector gesture={pan}>
    <View style={{ flex: 1 }}>
      {/* VoiceOver reads only the side that is showing. */}
      <View style={{ flex: 1 }} accessibilityElementsHidden={open} importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}>{children}</View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, shade]} />
      <Animated.View pointerEvents={open ? 'auto' : 'box-none'} accessibilityElementsHidden={!open} importantForAccessibility={open ? 'auto' : 'no-hide-descendants'} style={[StyleSheet.absoluteFill, { backgroundColor: colors.page }, sheet]}>{panel}</Animated.View>
    </View>
  </GestureDetector>;
}
