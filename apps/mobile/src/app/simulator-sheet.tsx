import { useLocalSearchParams } from "expo-router";
import { SimulatorSheet } from "../simulator";

export default function SimulatorScreen() {
  const { hostId, chatId } = useLocalSearchParams<{ hostId?: string; chatId?: string }>();
  return <SimulatorSheet key={`${hostId}:${chatId}`} hostId={hostId} chatId={chatId} />;
}
