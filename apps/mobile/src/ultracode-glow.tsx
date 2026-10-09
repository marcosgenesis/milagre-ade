import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { colors } from "./ui";

/** The composer's purple while Ultracode is on: a tint and a border that breathe slowly. Sits inside the composer's
 * rounded, clipped box; reduced motion holds it still. */
export function UltracodeGlow({ radius }: { radius: number }) {
  const breath = useSharedValue(0);
  useEffect(() => {
    breath.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.System }), -1, true));
  }, [breath]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 + breath.get() * 0.45 }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: radius, borderCurve: "continuous", borderWidth: 1.5, borderColor: colors.purple, backgroundColor: colors.purpleTint },
        style,
      ]}
    />
  );
}
