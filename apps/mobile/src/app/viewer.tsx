import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, FlatList, Image, PanResponder, Pressable, Text, View, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { Icon } from '../icons';
import { viewerImages, type ThumbRect } from '../viewer-store';

// Desktop's SPRING_LAYOUT (lib/ease.ts), the spring its lightbox morphs with.
const SPRING = { stiffness: 360, damping: 32, mass: 0.6, useNativeDriver: true } as const;
const FILL = 0.78;

/** The image's natural size, so the morph lines the fitted image up with its thumbnail. */
function naturalSize(source: ImageSourcePropType): Promise<{ width: number; height: number } | null> {
  const remote = source as { uri?: string; headers?: Record<string, string> };
  if (!remote?.uri) return Promise.resolve(null);
  return new Promise(resolve => {
    const done = (width: number, height: number) => resolve(width && height ? { width, height } : null);
    if (remote.headers) Image.getSizeWithHeaders(remote.uri!, remote.headers, done, () => resolve(null));
    else Image.getSize(remote.uri!, done, () => resolve(null));
  });
}

/**
 * Full-screen images, like desktop's lightbox: the image grows out of the thumbnail you tapped and shrinks back into
 * it on close. ✕ trailing; swipe sideways between a message's images, swipe down to close.
 */
export default function Viewer() {
  const { images, index } = viewerImages();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(index);
  const current = images[page];
  const [progress] = useState(() => new Animated.Value(0));
  const [drag] = useState(() => new Animated.Value(0));
  const [morph, setMorph] = useState<{ dx: number; dy: number; scale: number } | null>(null);
  const closingRef = useRef(false);
  // The pan handler is made once; it closes through the latest close, which knows the page now showing.
  const closeRef = useRef<() => void>(() => {});

  // Where the fitted image sits, scaled and moved onto a thumbnail: scale matches widths, the centers meet.
  const toThumb = async (from: ThumbRect | undefined, source: ImageSourcePropType) => {
    if (!from) return null;
    const size = await naturalSize(source);
    const ratio = size ? size.width / size.height : from.width / from.height;
    const fitted = ratio > width / (height * FILL) ? width : height * FILL * ratio;
    return { dx: from.x + from.width / 2 - width / 2, dy: from.y + from.height / 2 - height / 2, scale: from.width / fitted };
  };

  useEffect(() => {
    let cancelled = false;
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), toThumb(images[index]?.from, images[index]?.source)]).then(([reduced, start]) => {
      if (cancelled) return;
      setMorph(reduced ? null : start);
      Animated.spring(progress, { toValue: 1, ...SPRING }).start();
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- opens once

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    void Promise.all([AccessibilityInfo.isReduceMotionEnabled(), toThumb(current?.from, current?.source)]).then(([reduced, end]) => {
      setMorph(reduced ? null : end);
      Animated.parallel([Animated.spring(progress, { toValue: 0, ...SPRING }), Animated.spring(drag, { toValue: 0, ...SPRING })]).start(() => router.back());
    });
  };

  useEffect(() => { closeRef.current = close; });

  // A vertical drag pulls the image down; far or fast enough closes, like Photos.
  const [pan] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
    onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_, g) => { if (g.dy > 140 || g.vy > 1.2) closeRef.current(); else Animated.spring(drag, { toValue: 0, ...SPRING }).start(); },
  }));
  const along = (start: number, end: number) => progress.interpolate({ inputRange: [0, 1], outputRange: [start, end] });
  const figure = morph
    ? { transform: [{ translateX: along(morph.dx, 0) }, { translateY: Animated.add(along(morph.dy, 0), drag) }, { scale: along(morph.scale, 1) }] }
    : { opacity: progress, transform: [{ translateY: drag }, { scale: along(0.96, 1) }] };
  const chrome = { opacity: Animated.multiply(progress, drag.interpolate({ inputRange: [0, 200], outputRange: [1, 0], extrapolate: 'clamp' })) };
  return <View {...pan.panHandlers} style={{ flex: 1 }}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', inset: 0, backgroundColor: '#000', opacity: Animated.multiply(progress, drag.interpolate({ inputRange: [0, 300], outputRange: [1, 0.4], extrapolate: 'clamp' })) }} />
    <Animated.View style={[{ flex: 1 }, figure]}>
      <FlatList data={images} horizontal pagingEnabled initialScrollIndex={index} getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })} keyExtractor={(_, i) => String(i)} showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={({ nativeEvent }) => setPage(Math.round(nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => <View style={{ width, height, justifyContent: 'center' }}><Image accessibilityLabel={item.name} source={item.source} resizeMode="contain" style={{ width, height: height * FILL }} /></View>} />
    </Animated.View>
    <Animated.View style={[{ position: 'absolute', top: insets.top + 6, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, chrome]}>
      <View style={{ width: 44 }} />
      <View style={{ alignItems: 'center', flex: 1 }}><Text numberOfLines={1} style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{images.length > 1 ? `${page + 1} of ${images.length}` : current?.name}</Text>{images.length > 1 && <Text numberOfLines={1} style={{ color: '#ffffff99', fontSize: 12 }}>{current?.name}</Text>}</View>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={6} onPress={close} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: '#ffffff26', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}><Icon icon={Cancel01Icon} color="#ffffff" size={20} /></Pressable>
    </Animated.View>
    {images.length > 1 && <Animated.View style={[{ position: 'absolute', bottom: insets.bottom + 18, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 }, chrome]}>{images.map((_, i) => <View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === page ? '#fff' : '#ffffff59' }} />)}</Animated.View>}
  </View>;
}
