import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { FriendshipControls } from '../components/FriendshipControls'
import { PublicUserCard } from '../components/PublicUserCard'
import { EmptyState, Notice } from '../components/WorkspaceUI'
import { useAuth } from '../contexts/AuthContext'
import { errorText } from '../services/format'
import { normalizeUsername } from '../services/username'
import type { UserSearchResponse } from '../types/social'

const PAGE_SIZE = 12
const searchHint = 'Enter 1–24 letters, numbers or underscores. You can search part of a username.'

export function FindUsersPage() {
  const { request } = useAuth()
  const [params, setParams] = useSearchParams()
  const rawQuery = params.get('username') ?? ''
  const query = normalizeUsername(rawQuery).replace(/^@/, '')
  const parsedOffset = Number(params.get('offset') ?? '0')
  const offset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0
  const valid = /^[a-z0-9_]{1,24}$/.test(query)
  const [input, setInput] = useState(rawQuery)
  const [result, setResult] = useState<UserSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => { setInput(rawQuery) }, [rawQuery])

  useEffect(() => {
    if (!valid) { setResult(null); setLoading(false); setError(null); return }
    const controller = new AbortController()
    setLoading(true); setError(null); setResult(null)
    const search = new URLSearchParams({ username: query, limit: String(PAGE_SIZE), offset: String(offset) })
    request<UserSearchResponse>(`/users/search?${search}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [request, query, offset, valid, attempt])

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = normalizeUsername(input).replace(/^@/, '')
    if (!/^[a-z0-9_]{1,24}$/.test(value)) { setValidationError(searchHint); return }
    setValidationError(null)
    setParams({ username: value, offset: '0' })
    setAttempt((current) => current + 1)
  }

  function changePage(nextOffset: number) {
    setValidationError(null)
    setParams({ username: query, offset: String(nextOffset) })
  }

  return <section className="wb-card">
    <div className="wb-card-heading"><div><h2>Find people</h2><p>Connect with coaches, players and fans using their public usernames.</p></div></div>
    <form className="social-search-form" onSubmit={search} noValidate>
      <label className="wb-field">Username<input type="search" value={input} onChange={(event) => { setInput(event.target.value); setValidationError(null) }} placeholder="e.g. @coach_23" maxLength={25} autoCapitalize="none" spellCheck={false} aria-describedby="user-search-hint" /></label>
      <button className="wb-button wb-button-primary" disabled={loading}>{loading ? 'Searching...' : 'Search'}</button>
    </form>
    <p className="wb-muted" id="user-search-hint">{searchHint}</p>
    {(validationError || (query && !valid)) && <Notice kind="error">{validationError ?? searchHint}</Notice>}
    {error && <Notice kind="error">{error} <button className="wb-button wb-button-link" type="button" onClick={() => setAttempt((current) => current + 1)}>Try again</button></Notice>}
    {loading && <Notice>Searching for public profiles...</Notice>}
    {!query && !loading && <EmptyState>Search by username to find people. Only accounts with a public username appear here.</EmptyState>}
    {result && <>
      <p className="wb-muted" role="status">{result.total > 0 && result.items.length > 0 ? `${result.offset + 1}–${result.offset + result.items.length} of ${result.total} results` : `${result.total} results`} for @{query}</p>
      {result.items.length ? <div className="social-user-grid">{result.items.map((person) => <PublicUserCard key={person.id} person={person}><FriendshipControls person={person} /></PublicUserCard>)}</div> : <EmptyState>{result.total > 0 ? 'There are no results on this page. Go back to the previous page.' : 'No users match that username. Try a shorter search.'}</EmptyState>}
      {(result.total > PAGE_SIZE || result.offset > 0) && <div className="social-pagination"><button className="wb-button" type="button" disabled={loading || offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))}>← Previous</button><span className="wb-muted">Page {Math.floor(offset / PAGE_SIZE) + 1}</span><button className="wb-button" type="button" disabled={loading || offset + PAGE_SIZE >= result.total} onClick={() => changePage(offset + PAGE_SIZE)}>Next →</button></div>}
    </>}
  </section>
}
