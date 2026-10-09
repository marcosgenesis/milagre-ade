const { withInfoPlist, withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");
const NAME = "MilagreAgentActivity";
module.exports = function withLiveActivity(config) {
  const eas = config.extra?.eas ?? {};
  const build = eas.build ?? {};
  const experimental = build.experimental ?? {};
  const ios = experimental.ios ?? {};
  const extensions = ios.appExtensions ?? [];
  config.extra = {
    ...config.extra,
    eas: {
      ...eas,
      build: {
        ...build,
        experimental: {
          ...experimental,
          ios: {
            ...ios,
            appExtensions: [
              ...extensions.filter((extension) => extension.targetName !== NAME),
              { targetName: NAME, bundleIdentifier: `${config.ios.bundleIdentifier}.LiveActivity`, entitlements: {} },
            ],
          },
        },
      },
    },
  };
  config = withInfoPlist(config, (c) => {
    c.modResults.NSSupportsLiveActivities = true;
    return c;
  });
  config = withDangerousMod(config, [
    "ios",
    async (c) => {
      const root = c.modRequest.projectRoot;
      const dest = path.join(c.modRequest.platformProjectRoot, NAME);
      fs.mkdirSync(dest, { recursive: true });
      const base = path.join(root, "modules/live-activity");
      for (const file of ["AgentActivityWidget.swift", "MilagreAnswerIntent.swift"]) fs.copyFileSync(path.join(base, "widget", file), path.join(dest, file));
      fs.copyFileSync(path.join(base, "ios/AgentActivityAttributes.swift"), path.join(dest, "AgentActivityAttributes.swift"));
      fs.writeFileSync(
        path.join(dest, "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string><key>CFBundlePackageType</key><string>XPC!</string><key>CFBundleInfoDictionaryVersion</key><string>6.0</string><key>CFBundleDisplayName</key><string>Agent activity</string><key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string><key>CFBundleName</key><string>$(PRODUCT_NAME)</string><key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string><key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string><key>NSExtension</key><dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict></dict></plist>`,
      );
      return c;
    },
  ]);
  return withXcodeProject(config, (c) => {
    const p = c.modResults;
    const existing = Object.values(p.pbxNativeTargetSection()).some((t) => t && typeof t === "object" && t.name === NAME);
    if (existing) return c;
    const app = p.getFirstTarget();
    const appId = app.uuid;
    const appConfigs = p.pbxXCBuildConfigurationSection();
    const main = Object.values(appConfigs).find((b) => b && typeof b === "object" && b.buildSettings?.PRODUCT_BUNDLE_IDENTIFIER);
    const target = p.addTarget(NAME, "app_extension", NAME, `${c.ios.bundleIdentifier}.LiveActivity`);
    const group = p.addPbxGroup([], NAME, NAME);
    delete p.hash.project.objects.PBXGroup[group.uuid].path;
    const root = p.getFirstProject().firstProject.mainGroup;
    p.addToPbxGroup(group.uuid, root);
    p.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", target.uuid);
    p.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    for (const file of ["AgentActivityAttributes.swift", "MilagreAnswerIntent.swift", "AgentActivityWidget.swift"]) {
      const added = p.addSourceFile(`${NAME}/${file}`, { target: target.uuid }, group.uuid);
      if (file === "MilagreAnswerIntent.swift") {
        const appFile = { ...added, uuid: p.generateUuid(), target: appId };
        p.addToPbxBuildFileSection(appFile);
        p.addToPbxSourcesBuildPhase(appFile);
      }
    }
    for (const item of Object.values(p.pbxXCBuildConfigurationSection())) {
      if (!item || typeof item !== "object" || item.buildSettings?.PRODUCT_NAME !== `"${NAME}"`) continue;
      Object.assign(item.buildSettings, {
        PRODUCT_BUNDLE_IDENTIFIER: `${c.ios.bundleIdentifier}.LiveActivity`,
        INFOPLIST_FILE: `${NAME}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: "17.0",
        SWIFT_VERSION: "5.9",
        APPLICATION_EXTENSION_API_ONLY: "YES",
        SKIP_INSTALL: "YES",
        TARGETED_DEVICE_FAMILY: "1",
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: '"$(inherited) WIDGET_EXTENSION"',
        MARKETING_VERSION: c.version ?? "1.0.0",
        CURRENT_PROJECT_VERSION: main?.buildSettings.CURRENT_PROJECT_VERSION ?? "1",
        GENERATE_INFOPLIST_FILE: "NO",
      });
    }
    return c;
  });
};
