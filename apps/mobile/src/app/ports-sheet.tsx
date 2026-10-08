import { useLocalSearchParams } from "expo-router";
import { PortsSheet } from "../ports";

export default function PortsScreen() {
  const { hostId, chatId } = useLocalSearchParams<{ hostId?: string; chatId?: string }>();
  return <PortsSheet key={`${hostId}:${chatId}`} hostId={hostId} chatId={chatId} />;
}
