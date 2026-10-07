import { StyleSheet, View, useColorScheme } from "react-native";
import { ProgressiveBlurView } from "@sbaiahmed1/react-native-blur";
import { LinearGradient } from "expo-linear-gradient";
import { hex } from "./theme";

/**
 * Desktop's .progressive-blur (styles.css): content softens into the page at a screen edge. A native variable blur,
 * whose radius grows toward the edge, so no crisp copy shows through the way it does under one masked blur. The blur
 * builds up over `ramp` points from the open side; past that everything sits under the full blur and a near-opaque
 * page-colored tint.
 */
export function EdgeFade({ edge, height, ramp }: { edge: "top" | "bottom"; height: number; ramp: number }) {
  const scheme = useColorScheme();
  const page = hex(scheme).page;
  const end = Math.min(1, ramp / height);
  // Gradients run from the open side toward the screen edge.
  const flip = edge === "top" ? { start: { x: 0, y: 1 }, end: { x: 0, y: 0 } } : {};
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, [edge]: 0, height }}>
      <ProgressiveBlurView
        direction={edge === "top" ? "blurredTopClearBottom" : "blurredBottomClearTop"}
        startOffset={1 - end}
        blurAmount={20}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient {...flip} colors={[`${page}00`, `${page}cc`, page]} locations={[0, end, 1]} style={StyleSheet.absoluteFill} />
    </View>
  );
}
export const BottomFade = ({ height }: { height: number }) => <EdgeFade edge="bottom" height={height} ramp={48} />;
