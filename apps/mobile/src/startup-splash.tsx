import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useColorScheme } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as SplashScreen from 'expo-splash-screen';
import { hex } from './theme';

// The native launch screen shows the assembled mark at this size and spot, so the hand-off is seamless.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Desktop's StartupSplash logo paths (viewBox -4 -4 154 154).
const LEFT = 'M49.6983 66.5562L21.6836 116.174C19.802 119.507 22.2098 123.632 26.0372 123.632H39.9727L54.9727 100.132L66.9727 119.632L51.9727 144.132H26.0372C6.24066 144.132 -6.29344 122.89 3.27837 105.561L30.9405 55.4819L49.6983 66.5562Z';
const RIGHT = 'M142.666 105.561C152.238 122.89 139.704 144.132 119.907 144.132H93.9728L78.9728 119.632L90.9728 100.132L105.973 123.632H119.907C123.735 123.632 126.143 119.507 124.261 116.174L96.2462 66.5562L115.004 55.4819L142.666 105.561Z';
const STAR = 'M69.528 1.96636C71.0759 -0.655453 74.869 -0.655453 76.4169 1.96636L91.0103 26.6837C91.3538 27.2656 91.8392 27.751 92.4211 28.0945L117.138 42.6879C119.76 44.2358 119.76 48.0289 117.138 49.5768L92.4211 64.1702C91.8392 64.5137 91.3538 64.9991 91.0103 65.581L76.4169 90.2983C74.869 92.9201 71.0759 92.9201 69.528 90.2983L54.9347 65.581C54.5911 64.9991 54.1057 64.5137 53.5238 64.1702L28.8065 49.5768C26.1847 48.0289 26.1847 44.2358 28.8065 42.6879L53.5238 28.0945C54.1057 27.751 54.5911 27.2656 54.9347 26.6837L69.528 1.96636Z';
const SIZE = 64;
const SCALE = SIZE / 154;
// The sparkle's own box, so it can spin and scale around its centre like desktop's transform-box: fill-box.
const STAR_BOX = { x: 26.84, y: 0, size: 92.26 };

/**
 * Desktop's StartupSplash. The native launch screen already shows the assembled mark, so this takes over from it in
 * place: the sparkle twinkles until the app is ready, then the splash fades while the logo shrinks slightly.
 * Timings and curves match styles.css.
 */
export function StartupSplash({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const scheme = useColorScheme();
  const page = hex(scheme).page;
  const mark = scheme === 'dark' ? '#ffffff' : '#0a0a0a';
  const [[twinkle, leave]] = useState(() => [new Animated.Value(0), new Animated.Value(0)]);
  useEffect(() => {
    let reduced = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { reduced = value; });
    // A quarter turn with a dip in scale; four-fold symmetry makes the loop seamless.
    const loop = Animated.loop(Animated.sequence([Animated.timing(twinkle, { toValue: 1, duration: 1080, easing: Easing.bezier(0.65, 0, 0.35, 1), useNativeDriver: true }), Animated.timing(twinkle, { toValue: 0, duration: 0, useNativeDriver: true }), Animated.delay(1320)]));
    const timer = setTimeout(() => { if (!reduced) loop.start(); }, 300);
    return () => { loop.stop(); clearTimeout(timer); };
  }, [twinkle]);
  useEffect(() => {
    if (!ready) return;
    Animated.timing(leave, { toValue: 1, duration: 320, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }).start(() => onDone());
  }, [ready, leave, onDone]);
  const starStyle = {
    transform: [
      { scale: twinkle.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0.82, 1] }) },
      { rotate: twinkle.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) },
    ],
  };
  const layer = (path: string) => <Svg width={SIZE} height={SIZE} viewBox="-4 -4 154 154" style={StyleSheet.absoluteFill}><Path d={path} fill={mark} /></Svg>;
  return <Animated.View onLayout={() => void SplashScreen.hideAsync().catch(() => undefined)} accessibilityRole="progressbar" accessibilityLabel="Loading Milagre" pointerEvents={ready ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, { zIndex: 100, backgroundColor: page, alignItems: 'center', justifyContent: 'center', opacity: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
    <Animated.View style={{ width: SIZE, height: SIZE, transform: [{ scale: leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0.9] }) }] }}>
      {layer(LEFT)}
      {layer(RIGHT)}
      <Animated.View style={[{ position: 'absolute', left: (STAR_BOX.x + 4) * SCALE, top: (STAR_BOX.y + 4) * SCALE, width: STAR_BOX.size * SCALE, height: STAR_BOX.size * SCALE }, starStyle]}>
        <Svg width="100%" height="100%" viewBox={`${STAR_BOX.x} ${STAR_BOX.y} ${STAR_BOX.size} ${STAR_BOX.size}`}><Path d={STAR} fill={mark} /></Svg>
      </Animated.View>
    </Animated.View>
  </Animated.View>;
}
