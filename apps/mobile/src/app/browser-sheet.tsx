import { useLocalSearchParams } from "expo-router";
import { BrowserSheet } from "../browser";

export default function BrowserScreen() {
  const { hostId, chatId } = useLocalSearchParams<{ hostId?: string; chatId?: string }>();
  return <BrowserSheet hostId={hostId} chatId={chatId} />;
}
