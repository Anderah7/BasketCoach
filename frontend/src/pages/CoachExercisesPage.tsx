import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { DetailModal } from '../components/DetailModal'
import { MediaGallery } from '../components/ProtectedMedia'
import { MediaUploader } from '../components/MediaUploader'
import { EmptyState, Notice, PageHeading } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { categoryLabel, errorText } from '../services/format'
import { exerciseCategories } from '../types/sports'
import type { Exercise, ExerciseCategory } from '../types/sports'

export function CoachExercisesPage() {
  const { request, user } = useAuth()
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [collection, setCollection] = useState<'mine' | 'catalogue'>('mine')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<ExerciseCategory>('Shooting')
  const [difficulty, setDifficulty] = useState('')
  const [equipment, setEquipment] = useState('')
  const [mediaFiles, setMediaFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    request<Exercise[]>('/exercises', { signal: controller.signal }).then(setExercises)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
    return () => controller.abort()
  }, [request])

  async function createExercise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null); setSuccess(null)
    const form = event.currentTarget
    if (!name.trim() || !description.trim()) { setError('Enter the exercise name and description.'); return }
    setBusy(true)
    try {
      const created = await request<Exercise>('/exercises', { method: 'POST', body: {
        name: name.trim(), description: description.trim(), category,
        difficulty: difficulty.trim() || null, equipment: equipment.trim() || null,
      } })
      let finalExercise = created
      if (mediaFiles.length) {
        try {
          const body = new FormData(); mediaFiles.forEach((file) => body.append('files', file))
          const media_assets = await request<Exercise['media_assets']>(`/exercises/${created.id}/media`, { method: 'POST', body })
          finalExercise = { ...created, media_assets }
        } catch (cause) { setError(`Exercise created, but its media could not be uploaded: ${errorText(cause)}`) }
      }
      setExercises((current) => [...current, finalExercise].sort((a, b) => a.name.localeCompare(b.name)))
      setCollection('mine'); setSearch(''); setCategoryFilter('')
      setName(''); setDescription(''); setDifficulty(''); setEquipment('')
      setMediaFiles([])
      form.reset()
      setSuccess('Private exercise created. You can now use it in manual training sessions.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  async function changeVisibility(exercise: Exercise) {
    setBusy(true); setError(null); setSuccess(null)
    try {
      const updated = await request<Exercise>(`/exercises/${exercise.id}/visibility`, { method: 'PATCH', body: { is_public: !exercise.is_public } })
      setExercises((current) => current.map((item) => item.id === updated.id ? updated : item))
      setSelectedExercise((current) => current?.id === updated.id ? updated : current)
      setSuccess(updated.is_public ? 'Exercise published. Other users can now find it in the catalogue.' : 'Exercise is private again. Existing training sessions keep their exercise references.')
    } catch (cause) { setError(errorText(cause)) } finally { setBusy(false) }
  }

  const myExercises = exercises.filter((exercise) => exercise.created_by === user?.id)
  const publicExercises = exercises.filter((exercise) => exercise.is_public)
  const collectionExercises = collection === 'mine' ? myExercises : publicExercises
  const visible = collectionExercises.filter((exercise) => exercise.name.toLowerCase().includes(search.trim().toLowerCase())
    && (!categoryFilter || (categoryFilter === 'uncategorised' ? exercise.category === null : exercise.category === categoryFilter)))

  return <main className="wb-page">
    <PageHeading kicker="CATALOGUE" title="Exercises" description="Browse by name or category, create exercises and share your drills with the community." />
    {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
    <div className="wb-metrics"><div className="wb-metric"><span className="wb-metric-label">My exercises</span><strong className="wb-metric-value">{myExercises.length}</strong><span className="wb-metric-note">Created manually or with AI, private or public</span></div><div className="wb-metric"><span className="wb-metric-label">Public catalogue</span><strong className="wb-metric-value">{publicExercises.length}</strong><span className="wb-metric-note">Exercises shared with the community</span></div></div>
    <div className="wb-grid">
      <section className="wb-card"><div className="wb-card-heading"><h2>{collection === 'mine' ? 'My exercises' : 'Public catalogue'}</h2><span className="wb-pill">{visible.length} results</span></div>
        <div className="wb-collection-switch" role="group" aria-label="Exercise collection">
          <button type="button" aria-pressed={collection === 'mine'} onClick={() => setCollection('mine')}>My exercises <span>{myExercises.length}</span></button>
          <button type="button" aria-pressed={collection === 'catalogue'} onClick={() => setCollection('catalogue')}>Public catalogue <span>{publicExercises.length}</span></button>
        </div>
        <div className="wb-form-grid" style={{ marginBottom: 14 }}><label className="wb-field">Search by name<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Exercise name" /></label>
          <label className="wb-field">Filter by category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{exerciseCategories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}<option value="uncategorised">Uncategorised</option></select></label>
        </div>
        {visible.length ? <ul className="wb-list">{visible.map((exercise) => <li className="wb-list-row" key={exercise.id}><div className="wb-list-main"><strong>{exercise.name}</strong><span>{categoryLabel(exercise.category)} · {exercise.difficulty ?? 'Difficulty not set'}</span></div><button className="wb-button" onClick={() => setSelectedExercise(exercise)}>View details</button></li>)}</ul> : <EmptyState>No exercises match your search.</EmptyState>}
      </section>
      <section className="wb-card"><div className="wb-card-heading"><div><h2>New exercise</h2><p>It will be saved as a private exercise on your account.</p></div></div><form className="wb-form" onSubmit={createExercise}>
        <label className="wb-field">Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder="e.g. Pull-up jump shot" /></label>
        <label className="wb-field">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} required placeholder="How to perform the exercise" /></label>
        <label className="wb-field">Category<select value={category} onChange={(event) => setCategory(event.target.value as ExerciseCategory)}>{exerciseCategories.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}</select></label>
        <div className="wb-form-grid"><label className="wb-field">Difficulty<input value={difficulty} onChange={(event) => setDifficulty(event.target.value)} maxLength={30} placeholder="e.g. Intermediate" /></label><label className="wb-field">Equipment<input value={equipment} onChange={(event) => setEquipment(event.target.value)} placeholder="e.g. Basketballs" /></label></div>
        <label className="wb-field">Photos or videos (optional)<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" onChange={(event) => setMediaFiles(Array.from(event.target.files ?? []))} /></label>
        <div className="wb-form-actions"><button className="wb-button wb-button-primary" disabled={busy}>{busy ? 'Saving...' : 'Create exercise'}</button></div>
      </form></section>
    </div>
    {selectedExercise && <DetailModal title={selectedExercise.name} onClose={() => setSelectedExercise(null)}>
      {error && <Notice kind="error">{error}</Notice>}{success && <Notice kind="success">{success}</Notice>}
      <div className="wb-modal-summary"><span className="wb-pill">{categoryLabel(selectedExercise.category)}</span><span className="wb-pill">{selectedExercise.is_public ? 'Public' : 'Private'}</span></div>
      {selectedExercise.created_by === user?.id && <section className="wb-modal-section"><h3>Catalogue visibility</h3>
        <p className="wb-modal-description">{selectedExercise.is_public ? 'This exercise and its photos or videos are available to other users in the public catalogue.' : 'This exercise is private. You can use it in your sessions and share it with assigned players.'}</p>
        <div><button className="wb-button wb-button-primary" type="button" disabled={busy} onClick={() => void changeVisibility(selectedExercise)}>{busy ? 'Saving...' : selectedExercise.is_public ? 'Make private' : 'Make public'}</button></div>
      </section>}
      <section className="wb-modal-section"><h3>How to perform it</h3><p className="wb-modal-description">{selectedExercise.description || 'No description.'}</p></section>
      <section className="wb-modal-section"><h3>Exercise details</h3><div className="wb-modal-metadata"><span className="wb-pill">Difficulty: {selectedExercise.difficulty || 'Not set'}</span><span className="wb-pill">Equipment: {selectedExercise.equipment || 'Not set'}</span></div></section>
      <MediaGallery assets={selectedExercise.media_assets} label="Photos and videos" onRemove={selectedExercise.created_by === user?.id ? (id) => {
        void request(`/media/${id}`, { method: 'DELETE' }).then(() => {
          const updated = { ...selectedExercise, media_assets: selectedExercise.media_assets.filter((asset) => asset.id !== id) }
          setSelectedExercise(updated); setExercises((current) => current.map((item) => item.id === updated.id ? updated : item))
        }).catch((cause: unknown) => setError(errorText(cause)))
      } : undefined} />
      {selectedExercise.created_by === user?.id && <MediaUploader path={`/exercises/${selectedExercise.id}/media`} onUploaded={(assets) => {
        const updated = { ...selectedExercise, media_assets: [...selectedExercise.media_assets, ...assets] }
        setSelectedExercise(updated); setExercises((current) => current.map((item) => item.id === updated.id ? updated : item))
      }} />}
    </DetailModal>}
  </main>
}
