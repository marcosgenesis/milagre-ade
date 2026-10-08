import * as Device from "expo-device";
import { phoneNameFrom } from "./phone-name";

/** Read once per launch: a phone renamed in iOS Settings sends the new name after the app restarts. */
export const phoneName = phoneNameFrom(Device.deviceName, Device.modelName);
