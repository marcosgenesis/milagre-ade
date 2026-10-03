import { useState } from 'react';
import { Animated, FlatList, Image, PanResponder, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { Icon } from '../icons';
import { viewerImages } from '../viewer-store';

/** Full-screen images: ✕ leading, swipe sideways between a message's images, swipe down to close. */
export default function Viewer() {
  const { images, index } = viewerImages();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(index);
  const current = images[page];
  // A vertical drag pulls the image down; far or fast enough closes, like Photos.
  const [drag] = useState(() => new Animated.Value(0));
  const [pan] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
    onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => { if (g.dy > 140 || g.vy > 1.2) router.back(); else Animated.spring(drag, { toValue: 0, useNativeDriver: true }).start(); },
  }));
  const glass = (label: string, icon: typeof Cancel01Icon, onPress: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: '#ffffff26', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}><Icon icon={icon} color="#ffffff" size={20} /></Pressable>;
  return <Animated.View {...pan.panHandlers} style={{ flex: 1, backgroundColor: '#000', opacity: drag.interpolate({ inputRange: [0, 300], outputRange: [1, 0.4], extrapolate: 'clamp' }), transform: [{ translateY: drag }] }}>
    <FlatList data={images} horizontal pagingEnabled initialScrollIndex={index} getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })} keyExtractor={(_, i) => String(i)} showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={({ nativeEvent }) => setPage(Math.round(nativeEvent.contentOffset.x / width))}
      renderItem={({ item }) => <View style={{ width, height, justifyContent: 'center' }}><Image accessibilityLabel={item.name} source={item.source} resizeMode="contain" style={{ width, height: height * 0.78 }} /></View>} />
    <View style={{ position: 'absolute', top: insets.top + 6, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {glass('Close', Cancel01Icon, () => router.back())}
      <View style={{ alignItems: 'center', flex: 1 }}><Text numberOfLines={1} style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{images.length > 1 ? `${page + 1} of ${images.length}` : current?.name}</Text>{images.length > 1 && <Text numberOfLines={1} style={{ color: '#ffffff99', fontSize: 12 }}>{current?.name}</Text>}</View>
      <View style={{ width: 44 }} />
    </View>
    {images.length > 1 && <View style={{ position: 'absolute', bottom: insets.bottom + 18, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>{images.map((_, i) => <View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === page ? '#fff' : '#ffffff59' }} />)}</View>}
  </Animated.View>;
}
