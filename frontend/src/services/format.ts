import type { AssignmentStatus, ExerciseCategory } from '../types/sports'

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

export function toLocalDateTime(value: string): string {
  const date = new Date(value)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function statusLabel(status: AssignmentStatus): string {
  return {
    PENDING: 'Pending',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
  }[status]
}

export function categoryLabel(category: ExerciseCategory | null): string {
  if (!category) return 'Uncategorised'
  return {
    Shooting: 'Shooting',
    Defense: 'Defence',
    Physical: 'Physical training',
    'Ball handling': 'Ball handling',
    Passing: 'Passing',
    Rebounding: 'Rebounding',
    Tactics: 'Tactics',
  }[category]
}

export function positionLabel(position: string | null): string {
  if (!position) return 'Not set'
  return {
    'Point Guard': 'Point guard',
    'Shooting Guard': 'Shooting guard',
    'Small Forward': 'Small forward',
    'Power Forward': 'Power forward',
    Center: 'Centre',
  }[position] ?? position
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed.'
}
