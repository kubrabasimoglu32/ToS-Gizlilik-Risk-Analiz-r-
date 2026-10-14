import { createServer } from 'vite';
import { spawn } from 'node:child_process';

async function main() {
  const server = await createServer({
    root: process.cwd(),
    server: {
      port: 4173,
      strictPort: true,
    },
  });

  await server.listen();
  console.log('[E2E] Yerel fixture & uzantı sunucusu başlatıldı: http://localhost:4173');

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const cyProcess = spawn(npxCmd, ['cypress', 'run'], {
    stdio: 'inherit',
    shell: true,
  });

  const exitCode: number = await new Promise((resolve) => {
    cyProcess.on('close', (code) => resolve(code ?? 1));
  });

  await server.close();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error('[E2E Hatası]', err);
  process.exit(1);
});
