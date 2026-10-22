// index.ts — entry point server Cardora.
import { createApp } from './app';
import { config } from './config';
import { log } from './logger';
import { dbEnabled } from './db';

const { http, close } = createApp(config);
http.listen(config.port, config.host, () => {
  log.info('Cardora server siap', { port: config.port, db: dbEnabled() ? 'postgres' : 'mode tamu (tanpa DB)' });
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { log.info('shutdown', { sig }); close().then(() => process.exit(0)); });
}
