import { StyleSheet, View, useColorScheme } from "react-native";
import { ProgressiveBlurView } from "@sbaiahmed1/react-native-blur";
import { LinearGradient } from "expo-linear-gradient";
import { hex } from "./theme";

/**
 * Desktop's .progressive-blur (styles.css): content softens into the page at a screen edge. A native variable blur,
 * whose radius grows toward the edge, so no crisp copy shows through the way it does under one masked blur. The blur
 * and page-colored tint build linearly across the whole overlay, reaching full strength only at the screen edge.
 */
export function EdgeFade({ edge, height }: { edge: "top" | "bottom"; height: number }) {
  const scheme = useColorScheme();
  const page = hex(scheme).page;
  // Gradients run from the open side toward the screen edge.
  const flip = edge === "top" ? { start: { x: 0, y: 1 }, end: { x: 0, y: 0 } } : {};
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, [edge]: 0, height }}>
      <ProgressiveBlurView
        direction={edge === "top" ? "blurredTopClearBottom" : "blurredBottomClearTop"}
        startOffset={0}
        blurAmount={10}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient {...flip} colors={[`${page}00`, `${page}${edge === "bottom" ? "99" : "e6"}`]} style={StyleSheet.absoluteFill} />
    </View>
  );
}
export const BottomFade = ({ height }: { height: number }) => <EdgeFade edge="bottom" height={height} />;
