import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Dashboard } from '@/pages/dashboard';
import { TagsPage } from '@/pages/tags';
import { ScenariosPage } from '@/pages/scenarios';
import { ScenarioBuilder } from '@/pages/scenario-builder';
import { AFPage } from '@/pages/af';
import { useStatus } from '@/hooks/use-status';
import { Badge } from '@/components/ui/badge';

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/tags', label: 'Tags' },
  { to: '/scenarios', label: 'Scenarios' },
  { to: '/af', label: 'Asset Framework' },
];

function Layout() {
  const status = useStatus();
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-56 border-r border-border flex flex-col p-4 gap-2">
        <h1 className="text-lg font-bold mb-4">PI Simulator</h1>
        {status && (
          <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${status.status === 'running' ? 'bg-green-500' : 'bg-red-500'}`} />
            <span>{status.activeScenario !== 'normal' ? status.activeScenario : 'Normal'}</span>
            <Badge variant="outline" className="ml-auto text-[10px]">{status.mode}</Badge>
          </div>
        )}
        <nav className="flex flex-col gap-1">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}
              className={({ isActive }) =>
                `px-3 py-2 rounded-md text-sm transition-colors ${isActive ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-accent/50'}`
              }>
              {item.label}
            </NavLink>
          ))}
        </nav>
        {status && (
          <div className="mt-auto text-xs text-muted-foreground space-y-1">
            <p>Tags: {status.tags}</p>
            <p>WS Clients: {status.wsClients}</p>
            <p>Uptime: {Math.floor(status.uptime / 60)}m</p>
          </div>
        )}
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/scenarios/new" element={<ScenarioBuilder />} />
          <Route path="/scenarios/edit/:name" element={<ScenarioBuilder />} />
          <Route path="/af" element={<AFPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/ui">
      <Layout />
    </BrowserRouter>
  );
}
