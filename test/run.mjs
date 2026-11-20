if (process.platform === 'win32') await import('./windows-integration.mjs')
else await import('./test.mjs')
