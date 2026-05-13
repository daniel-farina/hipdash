import { Routes, Route } from 'react-router-dom';
import Topbar from './components/Topbar';
import Nav from './components/Nav';
import Overview from './pages/Overview';
import MtplxPage from './pages/Mtplx';
import OpencodePage from './pages/Opencode';
import SystemPage from './pages/System';
import RestartsPage from './pages/Restarts';

export default function App() {
  return (
    <div className="shell">
      <Topbar />
      <Nav />
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/mtplx" element={<MtplxPage />} />
        <Route path="/opencode" element={<OpencodePage />} />
        <Route path="/system" element={<SystemPage />} />
        <Route path="/restarts" element={<RestartsPage />} />
        <Route path="*" element={<Overview />} />
      </Routes>
    </div>
  );
}
