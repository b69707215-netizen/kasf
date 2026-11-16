const h = process.argv[2];
const m = {
  packageId: "ua.radf4.map", host: h, name: "Карта тривог України", launcherName: "Тривоги",
  display: "standalone", themeColor: "#181d26", navigationColor: "#181d26", backgroundColor: "#181d26",
  enableNotifications: false, startUrl: "/index.html",
  iconUrl: `https://${h}/icons/icon-512.png`, maskableIconUrl: `https://${h}/icons/icon-512.png`,
  webManifestUrl: `https://${h}/manifest.webmanifest`,
  appVersion: "1.0.0", appVersionCode: 1,
  signingKey: { path: "./radf4.keystore", alias: "radf4" },
  splashScreenFadeOutDuration: 300, fallbackType: "customtabs", minSdkVersion: 24, orientation: "default",
};
require("fs").writeFileSync("twa-manifest.json", JSON.stringify(m, null, 2));
