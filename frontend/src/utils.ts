export const calculateMbps = (bytes: number, ms: number): string => {
  if (ms === 0) return '0.00';
  const bits = bytes * 8;
  const megabits = bits / 1000000;
  const seconds = ms / 1000;
  return (megabits / seconds).toFixed(2);
};
