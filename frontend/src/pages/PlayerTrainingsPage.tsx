import { useEffect, useState } from 'react'
import { DetailModal } from '../components/DetailModal'
import { EmptyState, Notice, PageHeading, StatusPill } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { categoryLabel, errorText, formatDateTime } from '../services/format'
import type { PlayerTraining, PlayerTrainingDetail } from '../types/sports'

export function PlayerTrainingsPage() {
  const { request } = useAuth()
  const [trainings, setTrainings] = useState<PlayerTraining[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<PlayerTrainingDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [busyExercise, setBusyExercise] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request<PlayerTraining[]>('/players/me/trainings', { signal: controller.signal }).then(setTrainings)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request])

  useEffect(() => {
    if (selectedId === null) { setDetail(null); return }
    setDetailError(null)
    const controller = new AbortController()
    request<PlayerTrainingDetail>(`/players/me/trainings/${selectedId}`, { signal: controller.signal }).then(setDetail)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setDetailError(errorText(cause)) })
    return () => controller.abort()
  }, [request, selectedId])

  async function updateProgress(exerciseId: number, completed: boolean) {
    if (!detail) return
    setBusyExercise(exerciseId); setError(null); setSuccess(null)
    try {
      await request(`/players/me/trainings/${detail.assignment_id}/exercises/${exerciseId}`, { method: 'PATCH', body: { completed } })
      const [updatedDetail, updatedTrainings] = await Promise.all([
        request<PlayerTrainingDetail>(`/players/me/trainings/${detail.assignment_id}`),
        request<PlayerTraining[]>('/players/me/trainings'),
      ])
      setDetail(updatedDetail); setTrainings(updatedTrainings)
      setSuccess(completed ? 'Exercise marked as completed.' : 'Exercise marked as incomplete.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusyExercise(null) }
  }

  const done = detail?.exercises.filter((item) => item.completed).length ?? 0
  const total = detail?.exercises.length ?? 0

  return <main className="wb-page">
    <PageHeading kicker="MY SESSIONS" title="Training" description="Review your assignments and mark the exercises you have completed." />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <section className="wb-card"><div className="wb-card-heading"><h2>All my sessions</h2><span className="wb-pill">{trainings.length}</span></div>
      {trainings.length ? <ul className="wb-list">{trainings.map((item) => <li className="wb-list-row" key={item.assignment_id}>
        <div className="wb-list-main"><strong>{item.title}</strong><span>{item.team_name} · {formatDateTime(item.date)}</span><StatusPill status={item.status} /></div>
        <button className="wb-button" onClick={() => { setDetail(null); setDetailError(null); setSelectedId(item.assignment_id) }}>View details</button>
      </li>)}</ul> : <EmptyState>You have no assigned training sessions yet. They will appear here when your coach assigns one.</EmptyState>}
    </section>

    {selectedId !== null && <DetailModal title={detail?.title ?? 'Loading training session...'} onClose={() => setSelectedId(null)}>
      {detailError && <Notice kind="error">{detailError}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      {!detail && !detailError && <Notice>Loading session details...</Notice>}
      {detail && <>
        <div className="wb-modal-summary"><StatusPill status={detail.status} /><span className="wb-pill">{formatDateTime(detail.date)}</span><span className="wb-pill">{detail.duration} min</span></div>
        <p className="wb-modal-description">{detail.description || 'No description.'}</p>
        <div className="wb-modal-section"><div className="wb-split-action"><h3>Your progress</h3><strong>{total ? Math.round(done / total * 100) : 0}%</strong></div>
          <span className="wb-muted">{done} of {total} exercises completed</span><div className="wb-progress"><span style={{ width: `${total ? done / total * 100 : 0}%` }} /></div>
          {detail.status === 'CANCELLED' && <Notice>This assignment is cancelled. Your earlier progress is kept, but can no longer be changed.</Notice>}
        </div>
        <section className="wb-modal-section"><h3>Exercises in order</h3>
          {detail.exercises.map((item) => <div className="wb-modal-exercise" key={item.training_exercise_id}>
            <div className="wb-modal-exercise-head"><strong>{item.exercise_order}. {item.exercise.name}</strong><span className="wb-pill">{categoryLabel(item.exercise.category)}</span></div>
            <div className="wb-modal-metadata"><span className="wb-pill">{item.duration ?? '—'} min</span><span className="wb-pill">{item.sets ?? '—'} sets</span><span className="wb-pill">{item.repetitions ?? '—'} reps</span></div>
            <p>{item.exercise.description || 'No description.'}</p>
            <div className="wb-modal-metadata"><span className="wb-muted">Difficulty: {item.exercise.difficulty || 'Not set'}</span><span className="wb-muted">Equipment: {item.exercise.equipment || 'Not set'}</span></div>
            <div className="wb-split-action"><span className="wb-muted">{item.completed_at ? `Completed: ${formatDateTime(item.completed_at)}` : 'Pending'}</span>
              <label className="wb-checkbox"><input type="checkbox" checked={item.completed} disabled={detail.status === 'CANCELLED' || busyExercise !== null} onChange={(event) => void updateProgress(item.training_exercise_id, event.target.checked)} />Completed</label>
            </div>
          </div>)}
        </section>
      </>}
    </DetailModal>}
  </main>
}
