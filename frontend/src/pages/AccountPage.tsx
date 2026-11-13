import { PageHeading } from '../components/WorkspaceUI'
import { AvatarEditor } from '../components/AvatarEditor'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../services/format'

export function AccountPage() {
  const { user } = useAuth()
  if (!user) return null

  const role = user.role === 'coach' ? 'Coach' : 'Fan'

  return <main className="wb-page">
    <PageHeading kicker="MY ACCOUNT" title="Your details" description="Your account information, verified by BasketCoach." />
    <AvatarEditor />
    <section className="wb-card">
      <div className="wb-card-heading"><h2>{role} profile</h2></div>
      <ul className="wb-list">
        <li className="wb-list-row"><span className="wb-list-main"><strong>Name</strong></span><span className="wb-list-end">{user.name}</span></li>
        <li className="wb-list-row"><span className="wb-list-main"><strong>Email address</strong></span><span className="wb-list-end">{user.email}</span></li>
        <li className="wb-list-row"><span className="wb-list-main"><strong>Role</strong></span><span className="wb-list-end">{role}</span></li>
        <li className="wb-list-row"><span className="wb-list-main"><strong>Account created</strong></span><span className="wb-list-end">{formatDate(user.created_at)}</span></li>
      </ul>
    </section>
  </main>
}
