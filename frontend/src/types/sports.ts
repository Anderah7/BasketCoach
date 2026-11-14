export type ExerciseCategory =
  | 'Shooting' | 'Defense' | 'Physical' | 'Ball handling'
  | 'Passing' | 'Rebounding' | 'Tactics'

export type AssignmentStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export type CreationMode = 'MANUAL' | 'AI' | 'AI_ASSISTED'

export interface Team {
  id: number
  name: string
  category: string | null
  coach_id: number | null
  invitation_code: string | null
  is_managed: boolean
  created_at: string
}

export interface TeamPlayer {
  user_id: number
  name: string
  jersey_number: number | null
  position: string | null
  height_cm: number | null
  weight_kg: string | number | null
  strengths: string | null
  weaknesses: string | null
  avatar_media_id: number | null
}

export interface TeamPlayerDetail extends TeamPlayer {
  team_id: number
  birth_date: string | null
  email: string
  is_active: boolean
  created_at: string
}

export interface MediaAsset {
  id: number
  media_type: 'image' | 'video'
  content_type: string
  size_bytes: number
  created_at: string
}

export interface PlayerProfile {
  user_id: number
  team_id: number | null
  jersey_number: number | null
  position: string | null
  height_cm: number | null
  weight_kg: string | number | null
  birth_date: string | null
  strengths: string | null
  weaknesses: string | null
}

export interface Exercise {
  id: number
  name: string
  description: string | null
  category: ExerciseCategory | null
  difficulty: string | null
  equipment: string | null
  created_by: number | null
  is_public: boolean
  media_assets: MediaAsset[]
}

export interface TrainingListItem {
  id: number
  team_id: number
  created_by: number
  title: string
  description: string | null
  date: string
  duration: number
  creation_mode: CreationMode
}

export interface TrainingExerciseLink {
  id: number
  exercise_order: number
  duration: number | null
  sets: number | null
  repetitions: number | null
  exercise: Exercise
}

export interface TrainingDetail extends TrainingListItem {
  exercises: TrainingExerciseLink[]
  media_assets: MediaAsset[]
}

export interface TrainingExerciseInput {
  exercise_id: number
  duration: number | null
  sets: number | null
  repetitions: number | null
}

export interface TrainingAssignment {
  id: number
  training_id: number
  player_id: number
  player_name: string
  status: AssignmentStatus
  assigned_at: string
  completed_at: string | null
}

export interface TrainingProgress {
  assignment_id: number
  player_id: number
  player_name: string
  status: AssignmentStatus
  completed_exercises: number
  total_exercises: number
  progress_percent: number
  completed_at: string | null
}

export interface PlayerTraining {
  assignment_id: number
  training_id: number
  title: string
  date: string
  team_id: number
  team_name: string
  status: AssignmentStatus
  assigned_at: string
  completed_at: string | null
}

export interface PlayerTrainingExercise {
  training_exercise_id: number
  exercise_order: number
  duration: number | null
  sets: number | null
  repetitions: number | null
  exercise: Exercise
  completed: boolean
  completed_at: string | null
}

export interface PlayerTrainingDetail {
  assignment_id: number
  training_id: number
  title: string
  description: string | null
  date: string
  duration: number
  status: AssignmentStatus
  assigned_at: string
  completed_at: string | null
  exercises: PlayerTrainingExercise[]
  media_assets: MediaAsset[]
}

export interface NewExerciseProposal {
  name: string
  description: string
  category: ExerciseCategory
  difficulty: string
  equipment: string
  objective: string
}

export interface ProposedExercise {
  source: 'EXISTING' | 'NEW'
  existing_exercise_id: number | null
  new_exercise: NewExerciseProposal | null
  duration: number
  sets: number
  repetitions: number
  rationale: string
}

export interface AIProposal {
  generation_type: 'EXERCISES' | 'TRAINING'
  exercises: ProposedExercise[] | null
  training: {
    title: string
    description: string
    duration: number
    exercises: ProposedExercise[]
  } | null
}

export const exerciseCategories: ExerciseCategory[] = [
  'Shooting', 'Defense', 'Physical', 'Ball handling', 'Passing', 'Rebounding', 'Tactics',
]

export const playerPositions = [
  'Point Guard', 'Shooting Guard', 'Small Forward', 'Power Forward', 'Center',
] as const
