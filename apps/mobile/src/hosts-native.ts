import * as SecureStore from 'expo-secure-store';
import { createHostsStore } from './hosts-store';

export const savedHosts = createHostsStore({
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  deleteItemAsync: SecureStore.deleteItemAsync,
});
