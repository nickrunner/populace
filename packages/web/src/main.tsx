import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.jsx";
import "./theme.css";

// M1 is read-only over a store that only the CLI writes, so a poll is enough to notice a run in
// flight. M2 replaces this with the event stream (ADR-0026).
const client = new QueryClient({ defaultOptions: { queries: { refetchInterval: 5000, staleTime: 2000, retry: 1 } } });

const root = document.getElementById("root");
if (!root) throw new Error("no #root in the page");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
