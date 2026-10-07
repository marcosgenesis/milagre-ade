import { useLocalSearchParams } from "expo-router";
import { ArtifactSheet } from "../artifact";

export default function ArtifactScreen() {
  const { hostId, chatId, id, version } = useLocalSearchParams<{ hostId?: string; chatId?: string; id?: string; version?: string }>();
  return <ArtifactSheet key={`${hostId}:${chatId}:${id}`} hostId={hostId} chatId={chatId} id={id} version={version} />;
}
