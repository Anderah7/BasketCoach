const API_BASE = '/api/sports'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  token?: string
  signal?: AbortSignal
}

function fallbackError(status: number): string {
  if (status === 400) return 'Invalid request. Check the information you entered.'
  if (status === 401) return 'Your session has expired. Log in again.'
  if (status === 403) return 'You do not have permission to do this.'
  if (status === 404) return 'The requested item was not found.'
  if (status === 409) return 'This action conflicts with existing data.'
  if (status === 413) return 'The selected file is too large.'
  if (status === 422) return 'Check the form fields and try again.'
  if (status === 503) return 'The service is unavailable or not configured.'
  if (status === 504) return 'The service took too long to respond.'
  return 'The request could not be completed. Please try again.'
}

function englishDetail(detail: string, status: number): string {
  const translations: Record<string, string> = {
    'Email o contraseña incorrectos': 'Incorrect email or password.',
    'Usuario desactivado': 'Your account is inactive.',
    'El jugador ya pertenece a un equipo': 'You already belong to a team.',
    'Código de invitación inválido': 'Invalid invitation code.',
    'El jugador no pertenece a ningún equipo': 'You do not currently belong to a team.',
    'La asignación está cancelada': 'This assignment is cancelled and its progress cannot be changed.',
    'La asignación pertenece a un equipo anterior': 'This assignment belongs to a previous team.',
    'El entrenamiento ya tiene asignaciones': 'This training session already has assignments.',
    'El entrenamiento ya tiene progreso registrado': 'This training session already has recorded progress.',
    'Solo se pueden modificar entrenamientos manuales': 'Only manual training sessions can be edited or deleted.',
    'El dorsal ya está asignado en este equipo': 'That jersey number is already taken on this team.',
    'El dorsal ya está asignado a otro jugador': 'That jersey number is already assigned to another player.',
    'No eres el entrenador de este equipo': 'You are not the coach of this team.',
    'El jugador no pertenece a este equipo': 'This player does not belong to this team.',
    'No hay ejercicios del catálogo disponibles para este entrenador': 'No catalogue exercises are available for this coach.',
    'El servicio IA tardó demasiado': 'The AI service took too long to respond.',
    'No se pudo contactar con el servicio IA': 'Could not contact the AI service.',
    'La autenticación interna con el servicio IA falló': 'Internal authentication with the AI service failed.',
  }
  if (translations[detail]) return translations[detail]
  const missingExercise = detail.match(/^Ejercicio (\d+) no encontrado$/)
  if (missingExercise) return `Exercise ${missingExercise[1]} was not found.`
  const forbiddenExercise = detail.match(/^No puedes usar el ejercicio (\d+)$/)
  if (forbiddenExercise) return `You cannot use exercise ${forbiddenExercise[1]}.`
  if (['Name cannot be empty', 'Email already registered', 'Invalid email'].includes(detail)) return detail
  if (/^(Use a PNG|File exceeds the|Upload between|An item can have at most|Empty files are not allowed|Media not found|You cannot)/.test(detail)) return detail
  return fallbackError(status)
}

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = data.detail
    if (typeof detail === 'string') return englishDetail(detail, status)
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0]
      if (first && typeof first === 'object' && 'msg' in first && typeof first.msg === 'string') {
        return englishDetail(first.msg, status)
      }
    }
  }
  return fallbackError(status)
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : options.body instanceof FormData ? options.body : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Could not connect to BasketCoach. Check that the API Gateway is running.')
  }

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text) as unknown
    } catch {
      if (response.ok) throw new ApiError(502, 'The server returned an invalid response.')
    }
  }

  if (!response.ok) throw new ApiError(response.status, errorMessage(data, response.status))
  return data as T
}

export async function apiRequestBlob(path: string, options: ApiRequestOptions = {}): Promise<Blob> {
  const headers = new Headers()
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { headers, signal: options.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Could not connect to BasketCoach. Check that the API Gateway is running.')
  }
  if (!response.ok) throw new ApiError(response.status, fallbackError(response.status))
  return response.blob()
}
