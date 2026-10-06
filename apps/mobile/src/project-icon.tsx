import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { Folder01Icon } from '@hugeicons/core-free-icons';
import type { Client } from './client';
import { Icon } from './icons';
import { colors } from './theme';

// Desktop's project avatars: the repository's own icon or favicon, else its GitHub owner's avatar. Read once per
// computer and Project for the app's life; a Mac without project:image, or a Project without one, keeps the folder.
const images = new Map<string, Promise<string | null>>();

function projectImage(client: Client, path: string) {
  const key = `${client.url}|${path}`;
  let image = images.get(key);
  if (!image) {
    image = client.call<string | null>('project:image', [path]).then(value => typeof value === 'string' && /^(data:image\/|https:\/\/)/.test(value) ? value : null, () => null);
    images.set(key, image);
  }
  return image;
}

export function ProjectIcon({ client, path, size = 28 }: { client: Client | null; path: string; size?: number }) {
  const [source, setSource] = useState<{ key: string; uri: string | null } | null>(null);
  const key = client ? `${client.url}|${path}` : '';
  useEffect(() => {
    if (!client) return;
    let live = true;
    void projectImage(client, path).then(uri => { if (live) setSource({ key: `${client.url}|${path}`, uri }); });
    return () => { live = false; };
  }, [client, path]);
  const uri = source?.key === key ? source.uri : null;
  const frame = { width: size, height: size, borderRadius: size / 4, borderCurve: 'continuous' } as const;
  return uri ? <Image source={{ uri }} accessibilityIgnoresInvertColors style={[frame, { backgroundColor: colors.field }]} />
    : <View style={[frame, { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.field }]}><Icon icon={Folder01Icon} tone="ink2" size={size * 0.57} /></View>;
}

export function ProjectIcons({ client, projects }: { client: Client | null; projects: { id: string; path: string }[] }) {
  const visible = projects.slice(0, 3);
  return <View accessibilityLabel={`${projects.length} linked Projects`} style={{ width: 28 + Math.max(0, visible.length - 1) * 10, height: 28 }}>
    {visible.map((project, index) => <View key={project.id} style={{ position: 'absolute', left: index * 10, top: 0 }}><ProjectIcon client={client} path={project.path} /></View>)}
  </View>;
}
