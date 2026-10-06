import { useLocalSearchParams } from 'expo-router';
import { SimulatorSheet } from '../simulator';

export default function SimulatorScreen() {
  const { hostId } = useLocalSearchParams<{ hostId?: string }>();
  return <SimulatorSheet hostId={hostId} />;
}
