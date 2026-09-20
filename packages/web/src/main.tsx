import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.jsx";
import "./theme.css";

/**
 * No global `refetchInterval`. It re-asked for every screen in the product every five seconds —
 * including a persona form that only this browser can change — and it made the event stream a
 * duplicate rather than the thing that tells the page something happened. What moves on its own
 * now says so per query in `queries.ts`, and everything else is invalidated by the project's
 * event stream or by the mutation that changed it (ADR-0026).
 */
const client = new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: 1 } } });

const root = document.getElementById("root");
if (!root) throw new Error("no #root in the page");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
