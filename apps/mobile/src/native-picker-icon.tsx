import { Image } from "@expo/ui/swift-ui";
import { frame, resizable } from "@expo/ui/swift-ui/modifiers";
import { useColorScheme } from "react-native";
import { nativePickerIcons } from "./native-picker-icons.gen";

export type NativePickerIconName = keyof typeof nativePickerIcons;

/** SwiftUI-only label content keeps native menus clear of Fabric reparenting. */
export function NativePickerIcon({ name, size = 14 }: { name: NativePickerIconName; size?: number }) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return <Image uiImage={nativePickerIcons[name][scheme]} modifiers={[resizable(), frame({ width: size, height: size })]} />;
}
