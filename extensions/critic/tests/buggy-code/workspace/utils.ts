export function sumArray(numbers: number[] | null | undefined): number {
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < numbers.length; i++) {
    sum += numbers[i];
  }
  return sum;
}

export function findMax(arr: number[] | null | undefined): number {
  if (!arr || !Array.isArray(arr) || arr.length === 0) {
    return 0;
  }
  let max = arr[0];
  for (const num of arr) {
    if (num > max) {
      max = num;
    }
  }
  return max;
}

export function average(numbers: number[] | null | undefined): number {
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0) {
    return 0;
  }
  const sum = sumArray(numbers);
  return sum / numbers.length;
}
