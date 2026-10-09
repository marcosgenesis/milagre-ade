import { AppRegistry } from "react-native";
import { installActivityAnswers } from "./src/live-activity-native";

AppRegistry.registerComponent("MilagreLiveActivityTask", () => () => null);
installActivityAnswers();
// eslint-disable-next-line import/first -- Register the background component before Router starts the main app.
import "expo-router/entry";
