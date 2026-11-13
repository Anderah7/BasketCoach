import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { DetailModal } from '../components/DetailModal'
import { EmptyState, Notice, PageHeading, StatusPill } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { categoryLabel, errorText, formatDateTime, toLocalDateTime } from '../services/format'
import type { Exercise, Team, TeamPlayer, TrainingAssignment, TrainingDetail, TrainingExerciseInput, TrainingListItem, TrainingProgress } from '../types/sports'

interface Draft {
  title: string
  description: string
  date: string
  duration: number
  exercises: TrainingExerciseInput[]
}

function freshDraft(): Draft {
  return { title: '', description: '', date: toLocalDateTime(new Date().toISOString()), duration: 60, exercises: [] }
}

export function CoachTrainingsPage() {
  const { request } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null)
  const [catalogue, setCatalogue] = useState<Exercise[]>([])
  const [roster, setRoster] = useState<TeamPlayer[]>([])
  const [trainings, setTrainings] = useState<TrainingListItem[]>([])
  const [selectedTraining, setSelectedTraining] = useState<number | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detail, setDetail] = useState<TrainingDetail | null>(null)
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([])
  const [progress, setProgress] = useState<TrainingProgress[]>([])
  const [selectedPlayers, setSelectedPlayers] = useState<number[]>([])
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null)
  const [draft, setDraft] = useState<Draft>(freshDraft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      request<Team[]>('/teams/me', { signal: controller.signal }),
      request<Exercise[]>('/exercises', { signal: controller.signal }),
    ]).then(([loadedTeams, exercises]) => {
      setTeams(loadedTeams); setCatalogue(exercises); setSelectedTeam(loadedTeams[0]?.id ?? null)
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request])

  useEffect(() => {
    setSelectedTraining(null); setDetail(null); setDetailOpen(false); setAssignments([]); setProgress([]); setEditorMode(null)
    if (selectedTeam === null) { setTrainings([]); setRoster([]); return }
    const controller = new AbortController()
    Promise.all([
      request<TrainingListItem[]>(`/trainings?team_id=${selectedTeam}`, { signal: controller.signal }),
      request<TeamPlayer[]>(`/teams/${selectedTeam}/players`, { signal: controller.signal }),
    ]).then(([items, players]) => { setTrainings(items); setRoster(players) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request, selectedTeam])

  useEffect(() => {
    if (selectedTraining === null) { setDetail(null); setAssignments([]); setProgress([]); return }
    setDetailError(null)
    const controller = new AbortController()
    Promise.all([
      request<TrainingDetail>(`/trainings/${selectedTraining}`, { signal: controller.signal }),
      request<TrainingAssignment[]>(`/trainings/${selectedTraining}/assignments`, { signal: controller.signal }),
      request<TrainingProgress[]>(`/trainings/${selectedTraining}/progress`, { signal: controller.signal }),
    ]).then(([item, assigned, progressItems]) => {
      setDetail(item); setAssignments(assigned); setProgress(progressItems); setSelectedPlayers([])
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setDetailError(errorText(cause)) })
    return () => controller.abort()
  }, [request, selectedTraining])

  function updateExercise(index: number, key: keyof TrainingExerciseInput, value: number | null) {
    setDraft((current) => ({ ...current, exercises: current.exercises.map((item, position) => position === index ? { ...item, [key]: value } : item) }))
  }

  function moveExercise(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const items = [...current.exercises]
      const next = index + direction
      if (next < 0 || next >= items.length) return current
      ;[items[index], items[next]] = [items[next], items[index]]
      return { ...current, exercises: items }
    })
  }

  function openTraining(id: number) {
    if (selectedTraining === id && detail) {
      setDetailOpen(true); setEditorMode(null); return
    }
    setDetail(null); setAssignments([]); setProgress([]); setDetailError(null)
    setSelectedTraining(id); setDetailOpen(true); setEditorMode(null)
  }

  function startCreate() { setDraft(freshDraft()); setEditorMode('create'); setDetailOpen(false); setError(null); setSuccess(null) }
  function startEdit() {
    if (!detail || detail.creation_mode !== 'MANUAL' || assignments.length) return
    setDraft({
      title: detail.title, description: detail.description ?? '', date: toLocalDateTime(detail.date), duration: detail.duration,
      exercises: detail.exercises.map((link) => ({ exercise_id: link.exercise.id, duration: link.duration, sets: link.sets, repetitions: link.repetitions })),
    })
    setEditorMode('edit'); setDetailOpen(false); setError(null)
  }

  async function saveTraining(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedTeam === null || !editorMode) return
    if (!draft.title.trim() || !draft.date || !draft.exercises.length) { setError('Enter a title, date and at least one exercise.'); return }
    if (draft.duration <= 0 || draft.exercises.some((item) => item.exercise_id <= 0 || (item.duration !== null && item.duration <= 0) || (item.sets !== null && item.sets <= 0) || (item.repetitions !== null && item.repetitions <= 0))) {
      setError('Durations, sets and repetitions must be positive.'); return
    }
    setBusy(true); setError(null); setSuccess(null)
    try {
      const body = { title: draft.title.trim(), description: draft.description.trim() || null, date: new Date(draft.date).toISOString(), duration: Number(draft.duration), exercises: draft.exercises }
      const saved = editorMode === 'create'
        ? await request<TrainingDetail>('/trainings', { method: 'POST', body: { ...body, team_id: selectedTeam } })
        : await request<TrainingDetail>(`/trainings/${detail?.id}`, { method: 'PUT', body })
      const items = await request<TrainingListItem[]>(`/trainings?team_id=${selectedTeam}`)
      setTrainings(items); setSelectedTraining(saved.id); setDetail(saved); setEditorMode(null); setDetailOpen(true)
      setSuccess(editorMode === 'create' ? 'Manual training session created.' : 'Training session updated.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  async function deleteTraining() {
    if (!detail || !window.confirm(`Delete the training session "${detail.title}"?`)) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      await request<void>(`/trainings/${detail.id}`, { method: 'DELETE' })
      setTrainings((current) => current.filter((item) => item.id !== detail.id))
      setSelectedTraining(null); setDetail(null); setDetailOpen(false); setEditorMode(null); setSuccess('Training session deleted.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  async function assignPlayers() {
    if (!detail || !selectedPlayers.length) return
    setBusy(true); setError(null); setSuccess(null)
    try {
      await request<TrainingAssignment[]>(`/trainings/${detail.id}/assignments`, { method: 'POST', body: { player_ids: selectedPlayers } })
      const [assigned, updatedProgress] = await Promise.all([
        request<TrainingAssignment[]>(`/trainings/${detail.id}/assignments`),
        request<TrainingProgress[]>(`/trainings/${detail.id}/progress`),
      ])
      setAssignments(assigned); setProgress(updatedProgress); setSelectedPlayers([])
      setSuccess('Training session assigned to the selected players.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  const assignable = roster.filter((player) => !assignments.some((assignment) => assignment.player_id === player.user_id))
  return <main className="wb-page">
    <PageHeading kicker="PLANNING" title="Training" description="Create manual sessions, review AI sessions and track your team's assignments." actions={<button className="wb-button wb-button-primary" onClick={startCreate} disabled={selectedTeam === null || catalogue.length === 0}>+ New session</button>} />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    {teams.length ? <div className="wb-select-row"><label htmlFor="training-team">Team</label><select id="training-team" className="wb-input" value={selectedTeam ?? ''} onChange={(event) => setSelectedTeam(Number(event.target.value))}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div> : <Notice>Create a team from My teams first.</Notice>}
    <section className="wb-card">
      <div className="wb-card-heading"><h2>Team sessions</h2><span className="wb-pill">{trainings.length}</span></div>
      {trainings.length ? <ul className="wb-list">{trainings.map((item) => <li className="wb-list-row" key={item.id}>
        <div className="wb-list-main"><strong>{item.title}</strong><span>{formatDateTime(item.date)} · {item.duration} min · {item.creation_mode === 'MANUAL' ? 'Manual' : 'AI'}</span></div>
        <button className="wb-button" onClick={() => openTraining(item.id)}>View details</button>
      </li>)}</ul> : <EmptyState>This team has no training sessions yet.</EmptyState>}
    </section>

    {editorMode && <section className="wb-card" style={{ marginTop: 16 }}><div className="wb-card-heading"><h2>{editorMode === 'create' ? 'New manual session' : 'Edit manual session'}</h2><button className="wb-button" onClick={() => setEditorMode(null)}>Close</button></div><form className="wb-form" onSubmit={saveTraining}>
      <div className="wb-form-grid"><label className="wb-field">Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} maxLength={200} required /></label><label className="wb-field">Date and time<input type="datetime-local" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} required /></label></div>
      <div className="wb-form-grid"><label className="wb-field">Total duration (min)<input type="number" min="1" value={draft.duration} onChange={(event) => setDraft({ ...draft, duration: Number(event.target.value) })} required /></label><label className="wb-field">Description<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label></div>
      <div className="wb-card-heading"><h2>Exercises in order</h2><button className="wb-button" type="button" disabled={catalogue.length === 0} onClick={() => setDraft((current) => ({ ...current, exercises: [...current.exercises, { exercise_id: catalogue[0].id, duration: 10, sets: 3, repetitions: 8 }] }))}>+ Add</button></div>
      {draft.exercises.map((item, index) => <div className="wb-exercise-editor" key={`${index}-${item.exercise_id}`}><span className="wb-pill">{index + 1}</span><label className="wb-field wb-exercise-select">Exercise<select value={item.exercise_id} onChange={(event) => updateExercise(index, 'exercise_id', Number(event.target.value))}>{catalogue.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}</select></label><label className="wb-field">Min<input type="number" min="1" value={item.duration ?? ''} onChange={(event) => updateExercise(index, 'duration', event.target.value === '' ? null : Number(event.target.value))} /></label><label className="wb-field">Sets<input type="number" min="1" value={item.sets ?? ''} onChange={(event) => updateExercise(index, 'sets', event.target.value === '' ? null : Number(event.target.value))} /></label><label className="wb-field">Reps<input type="number" min="1" value={item.repetitions ?? ''} onChange={(event) => updateExercise(index, 'repetitions', event.target.value === '' ? null : Number(event.target.value))} /></label><div className="wb-inline-actions"><button className="wb-button" type="button" onClick={() => moveExercise(index, -1)} disabled={index === 0} aria-label="Move exercise up">↑</button><button className="wb-button" type="button" onClick={() => moveExercise(index, 1)} disabled={index === draft.exercises.length - 1} aria-label="Move exercise down">↓</button><button className="wb-button wb-button-danger" type="button" onClick={() => setDraft((current) => ({ ...current, exercises: current.exercises.filter((_, position) => position !== index) }))} aria-label="Remove exercise">×</button></div></div>)}
      {!draft.exercises.length && <EmptyState>Add at least one exercise from the catalogue.</EmptyState>}
      <div className="wb-form-actions"><button className="wb-button wb-button-primary" disabled={busy || !draft.exercises.length}>{busy ? 'Saving...' : 'Save session'}</button></div>
    </form></section>}

    {detailOpen && selectedTraining !== null && <DetailModal title={detail?.title ?? 'Loading training session...'} onClose={() => { setDetailOpen(false); setSelectedTraining(null) }}>
      {detailError && <Notice kind="error">{detailError}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      {!detail && !detailError && <Notice>Loading session details...</Notice>}
      {detail && <>
        <div className="wb-modal-summary">
          <span className="wb-pill">{detail.creation_mode === 'MANUAL' ? 'Manual' : 'Created with AI'}</span>
          <span className="wb-pill">{formatDateTime(detail.date)}</span>
          <span className="wb-pill">{detail.duration} min</span>
          <span className="wb-pill">{detail.exercises.length} exercises</span>
        </div>
        <p className="wb-modal-description">{detail.description || 'No description.'}</p>
        <div className="wb-modal-actions">
          <button className="wb-button" onClick={startEdit} disabled={detail.creation_mode !== 'MANUAL' || assignments.length > 0}>Edit session</button>
          <button className="wb-button wb-button-danger" onClick={() => void deleteTraining()} disabled={busy || detail.creation_mode !== 'MANUAL' || assignments.length > 0}>Delete session</button>
        </div>
        {assignments.length > 0 && <Notice>Assigned sessions keep their history and cannot be edited or deleted.</Notice>}

        <section className="wb-modal-section"><h3>Exercises in order</h3>
          {detail.exercises.map((link) => <div className="wb-modal-exercise" key={link.id}>
            <div className="wb-modal-exercise-head"><strong>{link.exercise_order}. {link.exercise.name}</strong><span className="wb-pill">{categoryLabel(link.exercise.category)}</span></div>
            <div className="wb-modal-metadata"><span className="wb-pill">{link.duration ?? '—'} min</span><span className="wb-pill">{link.sets ?? '—'} sets</span><span className="wb-pill">{link.repetitions ?? '—'} reps</span></div>
            <p>{link.exercise.description || 'No description.'}</p>
            <div className="wb-modal-metadata"><span className="wb-muted">Difficulty: {link.exercise.difficulty || 'Not set'}</span><span className="wb-muted">Equipment: {link.exercise.equipment || 'Not set'}</span></div>
          </div>)}
        </section>

        <section className="wb-modal-section"><h3>Assign to players</h3>
          {assignable.length ? <><div className="wb-tag-grid">{assignable.map((player) => <label className="wb-checkbox wb-tag" key={player.user_id}><input type="checkbox" checked={selectedPlayers.includes(player.user_id)} onChange={(event) => setSelectedPlayers((current) => event.target.checked ? [...current, player.user_id] : current.filter((id) => id !== player.user_id))} />{player.name}</label>)}</div>
            <div className="wb-form-actions"><button className="wb-button wb-button-primary" onClick={() => void assignPlayers()} disabled={busy || !selectedPlayers.length}>Assign session</button></div></> : <EmptyState>No new players are available for this session.</EmptyState>}
        </section>

        <section className="wb-modal-section"><h3>Team progress · {assignments.length} assignments</h3>
          {progress.length ? <ul className="wb-list">{progress.map((item) => <li className="wb-list-row" key={item.assignment_id}><div className="wb-list-main"><strong>{item.player_name}</strong><span>{item.completed_exercises}/{item.total_exercises} exercises · {item.progress_percent}%</span><div className="wb-progress"><span style={{ width: `${item.progress_percent}%` }} /></div></div><StatusPill status={item.status} /></li>)}</ul> : <EmptyState>This session has no assignments yet.</EmptyState>}
        </section>
      </>}
    </DetailModal>}
  </main>
}
