export enum Intent {
  Up = 2 ** 0,
  Right = 2 ** 1,
  Down = 2 ** 2,
  Left = 2 ** 3,
  Jump = 2 ** 4,
}

export function has(mask: number, inputs: Intent) {
  return (mask & inputs) === inputs
}
