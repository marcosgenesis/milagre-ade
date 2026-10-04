import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { PERMISSION_MODES } from '@milagre/shared/model-copy';
import type { PermissionMode } from '@milagre/shared/model';
import { PermissionIcon } from '../agent-controls';
import { useComposer } from '../session';
import { defaultPreferences } from '../turn-options';
import { Icon } from '../icons';
import { CircleButton, colors, styles } from '../ui';

/** Desktop's permission picker as a sheet: Ask approval, Auto mode, Full permission. A tap applies it and closes. */
export default function PermissionSheet() {
  const { chatId, busy } = useLocalSearchParams<{ chatId: string; busy?: string }>();
  const composer = useComposer();
  const current = (composer.preferences[chatId] || defaultPreferences).permissionMode;
  const pick = (mode: PermissionMode) => {
    composer.setPreferences(all => ({ ...all, [chatId]: { ...(all[chatId] || defaultPreferences), permissionMode: mode } }));
    router.back();
  };
  return <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
      <CircleButton label="Close" icon={Cancel01Icon} onPress={() => router.back()} />
      <Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 17, fontWeight: '600' }}>Permissions</Text>
      <View style={{ width: 40 }} />
    </View>
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      {busy === '1' && <Text style={styles.caption}>Applies to your next message. This turn keeps its permissions.</Text>}
      <View style={[styles.card, { paddingVertical: 0, paddingHorizontal: 0, gap: 0 }]}>
        {PERMISSION_MODES.map((mode, index) => <View key={mode.id}>
          {index > 0 && <View style={[styles.separator, { marginLeft: 52 }]} />}
          <Pressable accessibilityRole="radio" accessibilityState={{ selected: mode.id === current }} accessibilityLabel={`${mode.name}. ${mode.description}`} onPress={() => pick(mode.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, paddingHorizontal: 16, backgroundColor: pressed ? colors.hover : 'transparent' })}>
            <PermissionIcon mode={mode.id} size={20} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: mode.id === 'full' ? colors.orange : colors.ink, fontSize: 16, fontWeight: '500' }}>{mode.name}</Text>
              <Text style={styles.caption}>{mode.description}</Text>
            </View>
            {mode.id === current && <Icon icon={Tick02Icon} tone="accent" size={18} />}
          </Pressable>
        </View>)}
      </View>
    </View>
  </ScrollView>;
}
