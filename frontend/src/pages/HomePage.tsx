import { Link } from 'react-router'

const audiences = [
  { number: '01', title: 'For coaches', text: 'A clear view of your team and every training session.' },
  { number: '02', title: 'For players', text: 'Your own space to track your progress on the court.' },
  { number: '03', title: 'For fans', text: 'Stay closer to the game, the team and every matchday.' },
]

export function HomePage() {
  return (
    <main>
      <section className="home-hero" id="home">
        <div className="hero-copy">
          <div className="hero-kicker"><span className="kicker-dot" /> YOUR GAME STARTS HERE</div>
          <h1>Experience basketball<br /><em>from the inside.</em></h1>
          <p>One shared court to train better, grow together and see every play from a new angle.</p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/register">Get started <span aria-hidden="true">↗</span></Link>
            <Link className="button button-outline" to="/login">I already have an account</Link>
          </div>
        </div>
      </section>

      <section className="platform-section" id="platform">
        <div className="platform-intro">
          <span className="eyebrow eyebrow-dark">ONE SHARED PASSION</span>
          <h2>There is room for everyone<br />on this court.</h2>
          <p>BasketCoach brings together the people who plan the game, play it and never stop following it.</p>
        </div>
        <div className="audience-grid">
          {audiences.map((audience) => (
            <article className="audience-card" key={audience.number}>
              <span className="audience-number">{audience.number}</span>
              <div className="audience-orbit" aria-hidden="true" />
              <h3>{audience.title}</h3>
              <p>{audience.text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}
