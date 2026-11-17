import type { MatchStatus } from '../types/matches'

export const matchStatusLabel: Record<MatchStatus, string> = {
  SCHEDULED: 'Scheduled', FINISHED: 'Finished', CANCELLED: 'Cancelled',
}

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function monthWindow(month: Date) {
  // Local month boundaries become aware UTC instants, including DST changes.
  return {
    from: new Date(month.getFullYear(), month.getMonth(), 1).toISOString(),
    to: new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString(),
  }
}

export function calendarDays(month: Date): Date[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayOffset = (start.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), 1 - mondayOffset + index))
}

export function matchesPath(month: Date, teamId: string, seasonId: string, status: MatchStatus | '', offset = 0): string {
  const window = monthWindow(month)
  const query = new URLSearchParams({ date_from: window.from, date_to: window.to, limit: '200', offset: String(offset) })
  if (teamId) query.set('team_id', teamId)
  if (seasonId) query.set('season_id', seasonId)
  if (status) query.set('status', status)
  return `/matches?${query}`
}
