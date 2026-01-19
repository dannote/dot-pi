export function sumArray(numbers: number[]): number {
  let sum = 0;
  for (let i = 0; i <= numbers.length; i++) {  // Bug: off-by-one
    sum += numbers[i];
  }
  return sum;
}

export function findMax(arr: number[]): number {
  let max = arr[0];  // Bug: crashes on empty array
  for (const num of arr) {
    if (num > max) {
      max = num;
    }
  }
  return max;
}

export function average(numbers: number[]): number {
  const sum = sumArray(numbers);
  return sum / numbers.length;  // Bug: division by zero for empty array
}
