import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { DashboardLayout } from './components/DashboardLayout'
import { PublicLayout } from './components/PublicLayout'
import { GuestOnly, RequireAuth, RequireRole } from './components/RouteGuards'
import { AuthProvider } from './contexts/AuthContext'
import { AccountPage } from './pages/AccountPage'
import { CoachDashboard } from './pages/CoachDashboard'
import { CoachAIPage } from './pages/CoachAIPage'
import { CoachExercisesPage } from './pages/CoachExercisesPage'
import { CoachTeamsPage } from './pages/CoachTeamsPage'
import { CoachTrainingsPage } from './pages/CoachTrainingsPage'
import { FanDashboard } from './pages/FanDashboard'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { PlayerDashboard } from './pages/PlayerDashboard'
import { PlayerProfilePage } from './pages/PlayerProfilePage'
import { PlayerTeamPage } from './pages/PlayerTeamPage'
import { PlayerTrainingsPage } from './pages/PlayerTrainingsPage'
import { RegisterPage } from './pages/RegisterPage'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route index element={<GuestOnly><HomePage /></GuestOnly>} />
            <Route path="login" element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
          </Route>

          <Route element={<RequireAuth><DashboardLayout /></RequireAuth>}>
            <Route path="coach/dashboard" element={<RequireRole role="coach"><CoachDashboard /></RequireRole>} />
            <Route path="coach/teams" element={<RequireRole role="coach"><CoachTeamsPage /></RequireRole>} />
            <Route path="coach/exercises" element={<RequireRole role="coach"><CoachExercisesPage /></RequireRole>} />
            <Route path="coach/trainings" element={<RequireRole role="coach"><CoachTrainingsPage /></RequireRole>} />
            <Route path="coach/ai" element={<RequireRole role="coach"><CoachAIPage /></RequireRole>} />
            <Route path="coach/account" element={<RequireRole role="coach"><AccountPage /></RequireRole>} />
            <Route path="player/dashboard" element={<RequireRole role="player"><PlayerDashboard /></RequireRole>} />
            <Route path="player/team" element={<RequireRole role="player"><PlayerTeamPage /></RequireRole>} />
            <Route path="player/trainings" element={<RequireRole role="player"><PlayerTrainingsPage /></RequireRole>} />
            <Route path="player/profile" element={<RequireRole role="player"><PlayerProfilePage /></RequireRole>} />
            <Route path="fan/dashboard" element={<RequireRole role="fan"><FanDashboard /></RequireRole>} />
            <Route path="fan/account" element={<RequireRole role="fan"><AccountPage /></RequireRole>} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
