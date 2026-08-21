export {};

declare global {
  interface Window {
    glockworkDesktop?: {
      isElectron: boolean;
      platform: string;
    };
  }
}
