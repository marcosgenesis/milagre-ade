import { StyleSheet, View, useColorScheme } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { hex } from './theme';

/**
 * Desktop's chat-bottom-blur (styles.css): content blurs and fades into the page at a screen edge.
 * A backdrop blur masked to the outer part of the strip, then a page-colored gradient on top.
 */
export function EdgeFade({ edge, height, blur = true }: { edge: 'top' | 'bottom'; height: number; blur?: boolean }) {
  const scheme = useColorScheme();
  const page = hex(scheme).page;
  // Gradients run from the open side toward the screen edge.
  const flip = edge === 'top' ? { start: { x: 0, y: 1 }, end: { x: 0, y: 0 } } : {};
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, [edge]: 0, height }}>
    {blur && <MaskedView style={StyleSheet.absoluteFill} maskElement={<LinearGradient {...flip} colors={['transparent', '#000']} locations={[0.4, 0.8]} style={StyleSheet.absoluteFill} />}>
      <BlurView intensity={18} tint={scheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
    </MaskedView>}
    <LinearGradient {...flip} colors={[`${page}00`, `${page}b3`, page]} locations={[0, 0.6, 0.95]} style={StyleSheet.absoluteFill} />
  </View>;
}
export const BottomFade = ({ height }: { height: number }) => <EdgeFade edge="bottom" height={height} />;
