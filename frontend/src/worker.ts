import { setDebugEnabled } from './debug.ts';
import { runDownloadTest } from './worker/download.ts';
import { runPingTest } from './worker/ping.ts';
import { runUploadTest } from './worker/upload.ts';

self.onmessage = async (e: MessageEvent): Promise<void> => {
  if (e.data?.type === 'start') {
    const {
      base,
      calcMethod = 'peak',
      debug = false,
      sizeMB = 200,
      threads = 4,
      timeoutSec = 15,
    } = e.data;
    setDebugEnabled(debug === true);
    self.postMessage({ type: 'status', value: 'pinging' });
    await runPingTest(base);

    self.postMessage({ type: 'status', value: 'downloading' });
    await runDownloadTest(base, sizeMB, timeoutSec, threads, calcMethod);

    self.postMessage({ type: 'status', value: 'uploading' });
    await runUploadTest(base, sizeMB, timeoutSec, threads, calcMethod);

    self.postMessage({ type: 'status', value: 'done' });
  }
};
