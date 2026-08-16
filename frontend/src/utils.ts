export const calculateMbps = (bytes: number, ms: number): string => {
  return calculateMbpsNum(bytes, ms).toFixed(2);
};

export const calculateMbpsNum = (bytes: number, ms: number): number => {
  if (ms === 0) return 0;
  const bits = bytes * 8;
  const megabits = bits / 1000000;
  const seconds = ms / 1000;
  return megabits / seconds;
};
