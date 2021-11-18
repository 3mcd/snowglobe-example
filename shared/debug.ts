class InvariantError extends Error {
  name = "InvariantError"
}

export function invariant(condition: boolean, message?: string): asserts condition {
  if (condition === false) {
    throw new InvariantError(message)
  }
}
