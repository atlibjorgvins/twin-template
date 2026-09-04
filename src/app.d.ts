declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }
  /** package.json version, frozen into the bundle by vite.config.ts. */
  const __APP_VERSION__: string;
}

export {};
