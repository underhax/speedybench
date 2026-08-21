export const calculateMbps = (bytes: number, ms: number): string => {
  return calculateMbpsNum(bytes, ms).toFixed(2);
};

export const calculateMbpsNum = (bytes: number, ms: number): number => {
  if (ms === 0) return 0;
  const bits = bytes * 8 * 1.06;
  const megabits = bits / 1000000;
  const seconds = ms / 1000;
  return megabits / seconds;
};

export function formatSamplesTSV(
  samples: { bytes: number; speed: number; timeMs: number }[],
  metadata?: {
    methodLabel: string;
    methodValue: string;
    totalLabel: string;
    finalSpeed: string | number;
  },
): string {
  const columnHeader = ['Time (ms)', 'Size (MB)', 'Speed (Mbps)'].join('\t');
  const rows = samples.map((s) =>
    [s.timeMs.toFixed(0), (s.bytes / 1024 / 1024).toFixed(2), s.speed.toFixed(2)].join('\t'),
  );

  const result: string[] = [columnHeader, ...rows];

  if (metadata) {
    result.push('');
    result.push(`${metadata.methodLabel}\t${metadata.methodValue}`);
    result.push(`${metadata.totalLabel}\t${metadata.finalSpeed}`);
  }

  return result.join('\n');
}

export async function copyToClipboard(plainText: string): Promise<boolean> {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      const item = new ClipboardItem({
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {}
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(plainText);
      return true;
    } catch {}
  }
  try {
    const textArea = document.createElement('textarea');
    textArea.value = plainText;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const success = document.execCommand('copy');
    textArea.remove();
    return success;
  } catch {
    return false;
  }
}
