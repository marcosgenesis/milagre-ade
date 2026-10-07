import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { MAX_FILE_BYTES, MAX_PHOTO_BYTES, type Attachment } from "./attachments";

export async function pickAttachments(kind: "photos" | "camera" | "files"): Promise<Attachment[]> {
  if (kind === "photos" || kind === "camera") {
    if (kind === "camera" && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error("Allow camera access in Settings to take a photo.");
    const result =
      kind === "camera"
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"] })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 4 });
    if (result.canceled) return [];
    return Promise.all(
      result.assets.map(async (asset, index) => {
        const context = ImageManipulator.manipulate(asset.uri);
        context.resize(asset.width > asset.height ? { width: Math.min(asset.width, 1024) } : { height: Math.min(asset.height, 1024) });
        const rendered = await context.renderAsync();
        let photo = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
        if (((photo.base64?.length || 0) * 3) / 4 > MAX_PHOTO_BYTES)
          photo = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.35, base64: true });
        context.release();
        rendered.release();
        if (!photo.base64 || (photo.base64.length * 3) / 4 > MAX_PHOTO_BYTES)
          throw new Error("This photo is too detailed to send here. Use Files to attach the original.");
        const id = `${Date.now()}-${index}`,
          name = (asset.fileName || `Photo ${index + 1}`).replace(/\.[^.]+$/, "") + ".jpg";
        return { id, name, uri: photo.uri, image: { id, name, dataUrl: `data:image/jpeg;base64,${photo.base64}` } };
      }),
    );
  }
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
  if (result.canceled) return [];
  if (result.assets.length > 4) throw new Error("Attach up to 4 photos or files per message.");
  return Promise.all(
    result.assets.map(async (asset, index) => {
      const file = new File(asset.uri);
      if (file.size > MAX_FILE_BYTES) throw new Error(`${asset.name} is larger than 5 MiB.`);
      return { id: `${Date.now()}-${index}`, name: asset.name, uri: asset.uri, base64: await file.base64() };
    }),
  );
}
