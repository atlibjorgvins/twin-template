import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// Surface the package version to the app (Settings → About) so it's always
// clear which build is being inspected. Read at config time, frozen into the
// bundle as a literal.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [sveltekit()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  server: {
    port: 3030,
    host: '0.0.0.0'
  }
});
