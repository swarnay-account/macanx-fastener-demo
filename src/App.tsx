import { useEffect, useState } from 'react';
import { Sidebar, Topbar, Welcome, NoAccess } from './components/shell';
import { ToastHost } from './components/ui';
import { useRoute, ACCESS } from './modules';
import { useDB } from './data/store';
import { Dashboard } from './screens/Dashboard';
import { Sales } from './screens/Sales';
import { Planning } from './screens/Planning';
import { Purchase } from './screens/Purchase';
import { Inward } from './screens/Inward';
import { Production } from './screens/Production';
import { Galvanising } from './screens/Galvanising';
import { Dispatch } from './screens/Dispatch';
import { Stock } from './screens/Stock';
import { Trace } from './screens/Trace';
import { Maintenance } from './screens/Maintenance';
import { Controls } from './screens/Controls';
import { Reports } from './screens/Reports';
import { Approvals } from './screens/Approvals';
import { Masters } from './screens/Masters';
import type { ModuleId } from './data/types';

const SCREENS: Record<ModuleId, () => React.JSX.Element> = {
  dashboard: Dashboard, sales: Sales, planning: Planning, purchase: Purchase, inward: Inward, production: Production,
  galvanising: Galvanising, dispatch: Dispatch, stock: Stock, trace: Trace, maintenance: Maintenance, controls: Controls,
  reports: Reports, approvals: Approvals, masters: Masters,
};
const ENTERED = 'macanx-fastener-demo:entered';

export default function App() {
  const db = useDB();
  const route = useRoute();
  const [entered, setEntered] = useState(() => { try { return window.sessionStorage.getItem(ENTERED) === '1'; } catch { return false; } });
  const [menu, setMenu] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, [route]);

  if (!entered) return <Welcome onEnter={() => { try { window.sessionStorage.setItem(ENTERED, '1'); } catch { /* fine without it */ } setEntered(true); }} />;
  const Screen = SCREENS[route];
  return (
    <div className="app">
      <Sidebar open={menu} onClose={() => setMenu(false)} />
      <div className="app__main">
        <Topbar onMenu={() => setMenu(true)} onExit={() => { try { window.sessionStorage.removeItem(ENTERED); } catch { /* fine */ } setEntered(false); }} />
        <main className="content" key={`${route}:${db.plant}`}>
          {ACCESS[db.role].includes(route) ? <Screen /> : <NoAccess role={db.role} />}
        </main>
        <footer className="foot">Fastener ERP by MacanX for West Coast Corrotech Service LLP. Demo for evaluation; all names and figures are sample data. Copying or reverse engineering is not permitted.</footer>
      </div>
      <ToastHost />
    </div>
  );
}
