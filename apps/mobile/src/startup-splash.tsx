import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, useColorScheme } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as SplashScreen from 'expo-splash-screen';
import { hex } from './theme';
import { LEFT, RIGHT, STAR, STAR_BOX } from './logo';
import { hold, twinkleCurve, useKeyframes } from './running-logo';

// The native launch screen shows the assembled mark at this size and spot, so the hand-off is seamless.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const SIZE = 64;
const SCALE = SIZE / 154;

/**
 * Desktop's StartupSplash. The native launch screen already shows the assembled mark, so this takes over from it in
 * place: the sparkle twinkles until the app is ready, then the splash fades while the logo shrinks slightly.
 * Timings and curves match styles.css.
 */
export function StartupSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const scheme = useColorScheme();
  const page = hex(scheme).page;
  const mark = scheme === 'dark' ? '#ffffff' : '#0a0a0a';
  // splash-star-twinkle: 0%, 55% rest; 75% { scale(0.82) rotate(45deg) }; 100% { rotate(90deg) }, 2400ms.
  const twinkle = useKeyframes([hold(1320), { to: 1, duration: 480, easing: twinkleCurve }, { to: 2, duration: 600, easing: twinkleCurve }], 300);
  const [[fade, shrink]] = useState(() => [new Animated.Value(0), new Animated.Value(0)]);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    if (!ready) return;
    // splash-leave and splash-logo-leave run together with their own curves; runs once, so session updates cannot restart it.
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 320, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }),
      Animated.timing(shrink, { toValue: 1, duration: 320, easing: Easing.bezier(0.4, 0, 1, 1), useNativeDriver: true }),
    ]).start(() => done.current());
  }, [ready, fade, shrink]);
  const starStyle = {
    transform: [
      { scale: twinkle.interpolate({ inputRange: [0, 1, 2], outputRange: [1, 0.82, 1] }) },
      { rotate: twinkle.interpolate({ inputRange: [0, 1, 2], outputRange: ['0deg', '45deg', '90deg'] }) },
    ],
  };
  const layer = (path: string) => <Svg width={SIZE} height={SIZE} viewBox="-4 -4 154 154" style={StyleSheet.absoluteFill}><Path d={path} fill={mark} /></Svg>;
  return <Animated.View onLayout={() => void SplashScreen.hideAsync().catch(() => undefined)} accessibilityRole="progressbar" accessibilityLabel="Loading Milagre" pointerEvents={ready ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, { zIndex: 100, backgroundColor: page, alignItems: 'center', justifyContent: 'center', opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
    <Animated.View style={{ width: SIZE, height: SIZE, transform: [{ scale: shrink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) }] }}>
      {layer(LEFT)}
      {layer(RIGHT)}
      <Animated.View style={[{ position: 'absolute', left: (STAR_BOX.x + 4) * SCALE, top: (STAR_BOX.y + 4) * SCALE, width: STAR_BOX.size * SCALE, height: STAR_BOX.size * SCALE }, starStyle]}>
        <Svg width="100%" height="100%" viewBox={`${STAR_BOX.x} ${STAR_BOX.y} ${STAR_BOX.size} ${STAR_BOX.size}`}><Path d={STAR} fill={mark} /></Svg>
      </Animated.View>
    </Animated.View>
  </Animated.View>;
}
