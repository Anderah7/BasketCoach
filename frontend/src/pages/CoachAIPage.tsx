import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { EmptyState, Notice, PageHeading } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { categoryLabel, errorText, toLocalDateTime } from '../services/format'
import { exerciseCategories } from '../types/sports'
import type { AIProposal, Exercise, ExerciseCategory, NewExerciseProposal, ProposedExercise, Team, TeamPlayer, TrainingDetail } from '../types/sports'

type GenerationType = 'EXERCISES' | 'TRAINING'
type ExerciseMode = 'EXISTING' | 'NEW' | 'MIXED'

export function CoachAIPage() {
  const { request } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [players, setPlayers] = useState<TeamPlayer[]>([])
  const [catalogue, setCatalogue] = useState<Exercise[]>([])
  const [teamId, setTeamId] = useState<number | null>(null)
  const [prompt, setPrompt] = useState('')
  const [generationType, setGenerationType] = useState<GenerationType>('EXERCISES')
  const [exerciseMode, setExerciseMode] = useState<ExerciseMode>('MIXED')
  const [duration, setDuration] = useState('')
  const [choosePlayers, setChoosePlayers] = useState(false)
  const [playerIds, setPlayerIds] = useState<number[]>([])
  const [date, setDate] = useState(toLocalDateTime(new Date().toISOString()))
  const [proposal, setProposal] = useState<AIProposal | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      request<Team[]>('/teams/me', { signal: controller.signal }),
      request<Exercise[]>('/exercises', { signal: controller.signal }),
    ]).then(([loadedTeams, loadedCatalogue]) => {
      setTeams(loadedTeams); setCatalogue(loadedCatalogue); setTeamId(loadedTeams[0]?.id ?? null)
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request])

  useEffect(() => {
    setPlayerIds([]); setProposal(null)
    if (teamId === null) { setPlayers([]); return }
    const controller = new AbortController()
    request<TeamPlayer[]>(`/teams/${teamId}/players`, { signal: controller.signal }).then(setPlayers)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request, teamId])

  const proposedExercises = proposal?.generation_type === 'TRAINING' ? proposal.training?.exercises ?? [] : proposal?.exercises ?? []

  function changeExercises(change: (items: ProposedExercise[]) => ProposedExercise[]) {
    setProposal((current) => {
      if (!current) return null
      if (current.generation_type === 'TRAINING' && current.training) {
        return { ...current, training: { ...current.training, exercises: change(current.training.exercises) } }
      }
      return { ...current, exercises: change(current.exercises ?? []) }
    })
  }

  function updateExercise(index: number, patch: Partial<ProposedExercise>) {
    changeExercises((items) => items.map((item, position) => position === index ? { ...item, ...patch } : item))
  }

  function updateNewExercise(index: number, field: keyof NewExerciseProposal, value: string) {
    changeExercises((items) => items.map((item, position) => {
      if (position !== index || !item.new_exercise) return item
      return { ...item, new_exercise: { ...item.new_exercise, [field]: value } }
    }))
  }

  function moveExercise(index: number, step: -1 | 1) {
    changeExercises((items) => {
      const copy = [...items]
      const target = index + step
      if (target < 0 || target >= copy.length) return copy
      ;[copy[index], copy[target]] = [copy[target], copy[index]]
      return copy
    })
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setSuccess(null); setProposal(null)
    if (teamId === null || !prompt.trim()) { setError('Choose a team and describe what you want to work on.'); return }
    if (generationType === 'TRAINING' && (!duration || Number(duration) <= 0)) { setError('Enter the desired training duration.'); return }
    setBusy(true)
    try {
      const result = await request<AIProposal>('/ai/generate', { method: 'POST', body: {
        team_id: teamId, prompt: prompt.trim(), generation_type: generationType,
        exercise_mode: exerciseMode, duration: duration ? Number(duration) : null,
        ...(choosePlayers ? { player_ids: playerIds } : {}),
      } })
      setProposal(result)
      setSuccess('Proposal generated. Review and edit it before saving.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  async function acceptExercises() {
    const newItems = proposedExercises.filter((item) => item.source === 'NEW' && item.new_exercise).map((item) => item.new_exercise)
    if (!newItems.length) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const created = await request<Exercise[]>('/ai/exercises/accept', { method: 'POST', body: { exercises: newItems } })
      setCatalogue((current) => [...current, ...created])
      setSuccess(`${created.length} new exercise${created.length === 1 ? '' : 's'} saved privately. You can now use them in manual sessions.`)
      setProposal(null)
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  async function acceptTraining() {
    if (!proposal?.training || teamId === null || !date || !proposedExercises.length) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      const body = {
        team_id: teamId, date: new Date(date).toISOString(),
        title: proposal.training.title, description: proposal.training.description, duration: proposal.training.duration,
        exercises: proposedExercises.map((item) => ({
          source: item.source, existing_exercise_id: item.source === 'EXISTING' ? item.existing_exercise_id : null,
          new_exercise: item.source === 'NEW' ? item.new_exercise : null,
          duration: item.duration, sets: item.sets, repetitions: item.repetitions, rationale: item.rationale,
        })),
      }
      const created = await request<TrainingDetail>('/ai/trainings/accept', { method: 'POST', body })
      setProposal(null)
      setSuccess(`Training session "${created.title}" saved with ${created.exercises.length} exercises.`)
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  return <main className="wb-page">
    <PageHeading kicker="AI ASSISTANT" title="Plan from a fresh perspective" description="Gemini prepares a proposal. You decide what to edit and save." />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <div className="wb-grid">
      <section className="wb-card"><div className="wb-card-heading"><h2>New proposal</h2></div><form className="wb-form" onSubmit={generate}>
        <label className="wb-field">Team<select value={teamId ?? ''} onChange={(event) => setTeamId(Number(event.target.value))} disabled={!teams.length}>{teams.length ? teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>) : <option value="">Create a team first</option>}</select></label>
        <label className="wb-field">What do you want to work on?<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={4000} required placeholder="For example: improve catch-and-shoot three-pointers and transition defence..." /></label>
        <div className="wb-form-grid"><label className="wb-field">Generate<select value={generationType} onChange={(event) => setGenerationType(event.target.value as GenerationType)}><option value="EXERCISES">Exercises</option><option value="TRAINING">Full training session</option></select></label><label className="wb-field">Exercise mode<select value={exerciseMode} onChange={(event) => setExerciseMode(event.target.value as ExerciseMode)}><option value="MIXED">New and existing</option><option value="NEW">New only</option><option value="EXISTING">Catalogue only</option></select></label></div>
        <label className="wb-field">Desired duration (min){generationType === 'EXERCISES' && <span className="wb-muted">Optional for exercises</span>}<input type="number" min="1" max="240" value={duration} onChange={(event) => setDuration(event.target.value)} required={generationType === 'TRAINING'} placeholder="e.g. 60" /></label>
        <label className="wb-checkbox"><input type="checkbox" checked={choosePlayers} onChange={(event) => setChoosePlayers(event.target.checked)} />Select specific players</label>
        {choosePlayers && <div className="wb-tag-grid">{players.length ? players.map((player) => <label className="wb-checkbox wb-tag" key={player.user_id}><input type="checkbox" checked={playerIds.includes(player.user_id)} onChange={(event) => setPlayerIds((current) => event.target.checked ? [...current, player.user_id] : current.filter((id) => id !== player.user_id))} />{player.name}</label>) : <span className="wb-muted">This team has no players.</span>}</div>}
        <div className="wb-form-actions"><button className="wb-button wb-button-primary" disabled={busy || teamId === null}>{busy ? 'Generating...' : 'Generate proposal'}</button></div>
      </form></section>
      <section className="wb-card"><div className="wb-card-heading"><h2>Before you save</h2></div><div className="wb-stack"><p className="wb-muted">Generation does not save anything automatically. You can edit names, descriptions, exercises and quantities before accepting.</p><p className="wb-muted">New exercises are saved privately. Catalogue exercises keep their original details.</p><p className="wb-muted">You can review the sporting objective in the proposal, but the exercise model does not yet have a field to store it.</p><Link className="wb-button" to="/coach/exercises">View catalogue ↗</Link></div></section>
    </div>

    {proposal && <section className="wb-card" style={{ marginTop: 16 }}><div className="wb-card-heading"><div><h2>Review the proposal</h2><p>{proposal.generation_type === 'TRAINING' ? 'Full training session' : 'Individual exercises'}</p></div><button className="wb-button" onClick={() => setProposal(null)}>Discard</button></div>
      {proposal.training && <div className="wb-form-grid" style={{ marginBottom: 18 }}><label className="wb-field">Title<input value={proposal.training.title} onChange={(event) => setProposal({ ...proposal, training: { ...proposal.training!, title: event.target.value } })} /></label><label className="wb-field">Date and time<input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="wb-field">Description<textarea value={proposal.training.description} onChange={(event) => setProposal({ ...proposal, training: { ...proposal.training!, description: event.target.value } })} /></label><label className="wb-field">Total duration (min)<input type="number" min="1" value={proposal.training.duration} onChange={(event) => setProposal({ ...proposal, training: { ...proposal.training!, duration: Number(event.target.value) } })} /></label></div>}
      <div className="wb-stack">{proposedExercises.map((item, index) => <div className="wb-proposal" key={index}><div className="wb-split-action"><span className="wb-pill">{index + 1} · {item.source === 'NEW' ? 'New' : `Catalogue #${item.existing_exercise_id}`}</span><div className="wb-inline-actions"><button className="wb-button" onClick={() => moveExercise(index, -1)} disabled={index === 0} aria-label="Move up">↑</button><button className="wb-button" onClick={() => moveExercise(index, 1)} disabled={index === proposedExercises.length - 1} aria-label="Move down">↓</button><button className="wb-button wb-button-danger" onClick={() => changeExercises((items) => items.filter((_, position) => position !== index))} aria-label="Remove">×</button></div></div>
        {item.new_exercise ? <div className="wb-form"><div className="wb-form-grid"><label className="wb-field">Name<input value={item.new_exercise.name} onChange={(event) => updateNewExercise(index, 'name', event.target.value)} /></label><label className="wb-field">Category<select value={item.new_exercise.category} onChange={(event) => updateNewExercise(index, 'category', event.target.value as ExerciseCategory)}>{exerciseCategories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></label></div><label className="wb-field">Description<textarea value={item.new_exercise.description} onChange={(event) => updateNewExercise(index, 'description', event.target.value)} /></label><div className="wb-form-grid"><label className="wb-field">Difficulty<input value={item.new_exercise.difficulty} onChange={(event) => updateNewExercise(index, 'difficulty', event.target.value)} /></label><label className="wb-field">Equipment<input value={item.new_exercise.equipment} onChange={(event) => updateNewExercise(index, 'equipment', event.target.value)} /></label></div><label className="wb-field">Sporting objective<input value={item.new_exercise.objective} onChange={(event) => updateNewExercise(index, 'objective', event.target.value)} /></label></div> : <strong className="wb-muted">{catalogue.find((exercise) => exercise.id === item.existing_exercise_id)?.name ?? `Exercise #${item.existing_exercise_id}`}</strong>}
        <div className="wb-form-grid wb-proposal-amounts"><label className="wb-field">Minutes<input type="number" min="1" value={item.duration} onChange={(event) => updateExercise(index, { duration: Number(event.target.value) })} /></label><label className="wb-field">Sets<input type="number" min="1" value={item.sets} onChange={(event) => updateExercise(index, { sets: Number(event.target.value) })} /></label><label className="wb-field">Repetitions<input type="number" min="1" value={item.repetitions} onChange={(event) => updateExercise(index, { repetitions: Number(event.target.value) })} /></label></div><p className="wb-muted">{item.rationale}</p>
      </div>)}</div>
      <div className="wb-form-actions" style={{ marginTop: 18 }}>{proposal.generation_type === 'EXERCISES' ? <button className="wb-button wb-button-primary" onClick={() => void acceptExercises()} disabled={busy || !proposedExercises.some((item) => item.source === 'NEW')}>Save new exercises</button> : <button className="wb-button wb-button-primary" onClick={() => void acceptTraining()} disabled={busy || !proposedExercises.length}>Save training session</button>}</div>
      {!proposedExercises.length && <EmptyState>You have removed all exercises. Generate a new proposal.</EmptyState>}
    </section>}
  </main>
}
