import { StyleSheet, View, useColorScheme } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import { hex } from './theme';

/**
 * Desktop's chat-bottom-blur (styles.css): messages blur and fade into the page as they pass under the composer.
 * A backdrop blur masked from 20% to 60% of the strip's height, then a page-colored gradient on top.
 */
export function BottomFade({ height }: { height: number }) {
  const scheme = useColorScheme();
  const page = hex(scheme).page;
  return <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height }}>
    <MaskedView style={StyleSheet.absoluteFill} maskElement={<LinearGradient colors={['transparent', '#000']} locations={[0.4, 0.8]} style={StyleSheet.absoluteFill} />}>
      <BlurView intensity={18} tint={scheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
    </MaskedView>
    <LinearGradient colors={[`${page}00`, `${page}b3`, page]} locations={[0, 0.6, 0.95]} style={StyleSheet.absoluteFill} />
  </View>;
}
