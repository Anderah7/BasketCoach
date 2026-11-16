export const usernameHint = 'Use 3–24 letters, numbers or underscores. Your username is saved in lowercase.'

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidUsername(value: string): boolean {
  return /^[a-z0-9_]{3,24}$/.test(normalizeUsername(value))
}
