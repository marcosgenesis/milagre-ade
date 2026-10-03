import * as SecureStore from 'expo-secure-store';
import { createConnectionStore } from './connection-store';

export const savedConnection = createConnectionStore({
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: SecureStore.deleteItemAsync,
});
