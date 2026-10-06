import { Pressable, View } from 'react-native';
import { colors } from './theme';

export function MessageNavigation({ items, onSelect, top, bottom }: {
  items: { index: number; label: string }[];
  onSelect: (index: number) => void;
  top: number;
  bottom: number;
}) {
  if (items.length < 2) return null;
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top, bottom, width: 24, justifyContent: 'center' }}>
    {items.map(item => <Pressable key={item.index} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => onSelect(item.index)} style={{ height: 24, flexShrink: 1, width: 24, alignItems: 'center', justifyContent: 'center' }}>
      {({ pressed }) => <View style={{ width: pressed ? 16 : 4, height: 1, backgroundColor: pressed ? colors.ink : colors.lineStrong }} />}
    </Pressable>)}
  </View>;
}
