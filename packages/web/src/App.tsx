import { useQuery } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { api } from "./api.js";
import { Sidebar } from "./components/Sidebar.jsx";
import { Card, Failed, Loading } from "./components/ui.jsx";
import { Overview } from "./screens/Overview.jsx";
import { Findings } from "./screens/Findings.jsx";
import { FindingInFull } from "./screens/FindingInFull.jsx";
import { Gaps } from "./screens/Gaps.jsx";
import { WhoLeft } from "./screens/WhoLeft.jsx";
import { Population } from "./screens/Population.jsx";
import { Wakes } from "./screens/Wakes.jsx";
import { WatchAVisit } from "./screens/WatchAVisit.jsx";

/** Every screen is scoped to a run, so the shell resolves one before it renders anything. */
function RunShell() {
  const { runId } = useParams();
  if (runId === undefined) return <Navigate to="/" replace />;
  return (
    <div className="flex h-full">
      <Sidebar runId={runId} />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[1100px] px-10 py-9">
          <Routes>
            <Route index element={<Overview runId={runId} />} />
            <Route path="findings" element={<Findings runId={runId} />} />
            <Route path="findings/:clusterId" element={<FindingInFull runId={runId} />} />
            <Route path="gaps" element={<Gaps runId={runId} />} />
            <Route path="left" element={<WhoLeft runId={runId} />} />
            <Route path="population" element={<Population runId={runId} />} />
            <Route path="wakes" element={<Wakes runId={runId} />} />
            <Route path="wakes/:wakeId" element={<WatchAVisit runId={runId} />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

/**
 * With no run in the URL, open the newest one. A store with nothing in it is the first thing a
 * new user sees, so it says what to do rather than showing an empty dashboard.
 */
function LatestRun() {
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api.runs() });
  if (runs.isPending) return <div className="p-10"><Loading what="your runs" /></div>;
  if (runs.isError) return <div className="p-10"><Failed error={runs.error} /></div>;

  const latest = runs.data.items[0];
  if (!latest) {
    return (
      <div className="p-10 max-w-[60ch]">
        <h1 className="t-title mb-3">Nothing has run yet</h1>
        <Card className="p-4">
          <p className="t-body text-ink-soft">
            This dashboard reads the store the CLI writes. Send a population at your target and the run will appear here.
          </p>
          <pre className="font-mono text-[12px] bg-well border border-rule rounded p-3 mt-3">populace run --new-run</pre>
        </Card>
      </div>
    );
  }
  return <Navigate to={`/runs/${encodeURIComponent(latest.id)}`} replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LatestRun />} />
        <Route path="/runs/:runId/*" element={<RunShell />} />
      </Routes>
    </BrowserRouter>
  );
}
