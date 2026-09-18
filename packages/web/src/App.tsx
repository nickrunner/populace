import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { api } from "./api.js";
import { Sidebar } from "./components/Sidebar.jsx";
import { Failed, Loading } from "./components/ui.jsx";
import { Overview } from "./screens/Overview.jsx";
import { Findings } from "./screens/Findings.jsx";
import { FindingInFull } from "./screens/FindingInFull.jsx";
import { Gaps } from "./screens/Gaps.jsx";
import { WhoLeft } from "./screens/WhoLeft.jsx";
import { Population } from "./screens/Population.jsx";
import { Wakes } from "./screens/Wakes.jsx";
import { WatchAVisit } from "./screens/WatchAVisit.jsx";
import { LiveRun } from "./screens/LiveRun.jsx";
import { NewRun } from "./screens/NewRun.jsx";
import { Connect } from "./screens/setup/Connect.jsx";
import { People } from "./screens/setup/People.jsx";
import { PersonEditor } from "./screens/setup/PersonEditor.jsx";
import { ConfigFile } from "./screens/setup/ConfigFile.jsx";
import { Limits } from "./screens/setup/Limits.jsx";

/** One navigation and one page frame, whether or not there is a run to be scoped to. */
function Frame({ runId, children }: { runId: string | null; children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar runId={runId} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1100px] px-10 py-9">{children}</div>
      </main>
    </div>
  );
}

/**
 * The setting-up screens are not scoped to a run — they are what produces one — but they keep the
 * same frame, because there is no separate setup mode to be in and out of. The sidebar still shows
 * the newest run so the evidence is one click away while you are editing the people who produced it.
 */
function SetupFrame({ children }: { children: React.ReactNode }) {
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs() });
  return <Frame runId={runs.data?.items[0]?.id ?? null}>{children}</Frame>;
}

function RunShell() {
  const { runId } = useParams();
  if (runId === undefined) return <Navigate to="/" replace />;
  return (
    <Frame runId={runId}>
      <Routes>
        <Route index element={<Overview runId={runId} />} />
        <Route path="live" element={<LiveRun runId={runId} />} />
        <Route path="findings" element={<Findings runId={runId} />} />
        <Route path="findings/:clusterId" element={<FindingInFull runId={runId} />} />
        <Route path="gaps" element={<Gaps runId={runId} />} />
        <Route path="left" element={<WhoLeft runId={runId} />} />
        <Route path="population" element={<Population runId={runId} />} />
        <Route path="wakes" element={<Wakes runId={runId} />} />
        <Route path="wakes/:wakeId" element={<WatchAVisit runId={runId} />} />
      </Routes>
    </Frame>
  );
}

/**
 * With no run in the URL, open the newest one — and with nothing to open, start where a new user
 * has to start, which is connecting a target rather than reading an empty dashboard.
 */
function Landing() {
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs() });
  if (runs.isPending)
    return (
      <div className="p-10">
        <Loading what="your runs" />
      </div>
    );
  if (runs.isError)
    return (
      <div className="p-10">
        <Failed error={runs.error} />
      </div>
    );

  const latest = runs.data.items[0];
  if (!latest) return <Navigate to="/setup/target" replace />;
  // A run still going opens on the screen that shows it going.
  return <Navigate to={`/runs/${encodeURIComponent(latest.id)}${latest.status === "running" || latest.status === "pending" ? "/live" : ""}`} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/setup/target" element={<SetupFrame><Connect /></SetupFrame>} />
        <Route path="/setup/people" element={<SetupFrame><People /></SetupFrame>} />
        <Route path="/setup/people/:personaId" element={<SetupFrame><PersonEditor /></SetupFrame>} />
        <Route path="/setup/limits" element={<SetupFrame><Limits /></SetupFrame>} />
        <Route path="/setup/config" element={<SetupFrame><ConfigFile /></SetupFrame>} />
        <Route path="/start" element={<SetupFrame><NewRun /></SetupFrame>} />
        <Route path="/runs/:runId/*" element={<RunShell />} />
      </Routes>
    </BrowserRouter>
  );
}
