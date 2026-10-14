import { defineConfig } from 'cypress';
import { resolve } from 'node:path';

export default defineConfig({
  video: true,
  videoCompression: false,
  viewportWidth: 1280,
  viewportHeight: 800,
  e2e: {
    baseUrl: 'http://localhost:4173',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: false,
    setupNodeEvents(on, _config) {
      on('before:browser:launch', (browser, launchOptions) => {
        const extensionDistPath = resolve(process.cwd(), 'dist');
        if (browser.family === 'chromium' && browser.name !== 'electron') {
          launchOptions.args.push(`--load-extension=${extensionDistPath}`);
          launchOptions.args.push(
            `--disable-extensions-except=${extensionDistPath}`
          );
        }
        return launchOptions;
      });
    },
  },
});
