import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

// Heavy, heavy, heavy, then a rigid snap: a short rumble rather than one tap, so Ultra feels like it kicked in.
const PULSES: [number, Haptics.ImpactFeedbackStyle][] = [
  [0, Haptics.ImpactFeedbackStyle.Heavy],
  [90, Haptics.ImpactFeedbackStyle.Heavy],
  [180, Haptics.ImpactFeedbackStyle.Heavy],
  [320, Haptics.ImpactFeedbackStyle.Rigid],
];

/** Picking Ultra (Ultracode on, or the ultra effort level): the phone rumbles. iOS only, like the app's other haptics. */
export function ultraRumble() {
  if (Platform.OS !== "ios") return;
  for (const [delay, style] of PULSES) setTimeout(() => void Haptics.impactAsync(style).catch(() => {}), delay);
}
