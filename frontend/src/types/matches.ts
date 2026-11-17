export type MatchStatus = 'SCHEDULED' | 'FINISHED' | 'CANCELLED'

export interface MatchTeam {
  id: number
  name: string
  category: string | null
  coach_id: number | null
}

export interface MatchSeason {
  id: number
  name: string
  start_date: string
  end_date: string
}

export interface MatchOptions {
  teams: MatchTeam[]
  seasons: (MatchSeason & { team_ids: number[] })[]
}

export interface Match {
  id: number
  home_team: MatchTeam
  away_team: MatchTeam
  match_date: string
  location: string | null
  season: MatchSeason | null
  home_score: number | null
  away_score: number | null
  status: MatchStatus
  can_manage: boolean
}

export interface MatchPage {
  items: Match[]
  total: number
  limit: number
  offset: number
}

export interface MatchInput {
  home_team_id: number
  away_team_id: number
  match_date: string
  location: string | null
  season_id: number | null
}
