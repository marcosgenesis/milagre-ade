// Image assets imported from code resolve to a React Native image source (Metro bundles them; OTA ships them).
declare module "*.png" {
  const source: import("react-native").ImageSourcePropType;
  export default source;
}
