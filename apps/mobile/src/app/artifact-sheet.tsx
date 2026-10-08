import { useLocalSearchParams } from "expo-router";
import { ArtifactSheet } from "../artifact";

export default function ArtifactScreen() {
  const { hostId, chatId, id, version, chosen } = useLocalSearchParams<{ hostId?: string; chatId?: string; id?: string; version?: string; chosen?: string }>();
  return <ArtifactSheet key={`${hostId}:${chatId}:${id}`} hostId={hostId} chatId={chatId} id={id} version={version} chosen={chosen} />;
}
