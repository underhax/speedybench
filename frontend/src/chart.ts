export function drawAreaChart(rawData: number[], colorVar: string): string {
  const data = rawData.length > 0 ? [0, ...rawData] : [];
  if (data.length < 2) return '';

  const width = 1000;
  const height = 100;

  const maxVal = Math.max(...data, 1);

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (val / maxVal) * height;
    return { x, y };
  });

  const firstPoint = points[0];
  if (!firstPoint) return '';

  let path = `M ${firstPoint.x},${firstPoint.y}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;

    const cpX = (prev.x + curr.x) / 2;
    path += ` C ${cpX},${prev.y} ${cpX},${curr.y} ${curr.x},${curr.y}`;
  }

  const areaPath = `${path} L ${width},${height} L 0,${height} Z`;

  const gradientId = `grad-${colorVar.replace(/[^a-zA-Z0-9]/gu, '')}`;

  return `
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(${colorVar})" stop-opacity="0.15" />
        <stop offset="100%" stop-color="var(${colorVar})" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#${gradientId})" stroke="none" />
    <path d="${path}" fill="none" stroke="var(${colorVar})" stroke-width="1.5" stroke-opacity="0.5" stroke-linecap="round" stroke-linejoin="round" />
  `;
}
