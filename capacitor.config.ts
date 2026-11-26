import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ikayiyange.onboardingtest",
  appName: "Ikayi Test",
  webDir: ".output/public",
  backgroundColor: "#D75A1B",
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#D75A1B",
      showSpinner: false,
      androidSplashResourceName: "splash",
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#D75A1B",
  },
};

export default config;
