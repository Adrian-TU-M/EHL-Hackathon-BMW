import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import AppShell from "./components/dashboard/AppShell";
import { Loading } from "./components/ui/Primitives";
import "./styles.css";
import "./premium.css";
import FlutedGlass from "./components/ui/fluted-glass";
const Customer = lazy(() => import("./pages/Customer"));
const Market = lazy(() => import("./pages/Market"));
const Competitor = lazy(() => import("./pages/Competitor"));
const Council = lazy(() => import("./pages/Council"));
const Decisions = lazy(() => import("./pages/Decisions"));
const Presentations = lazy(() => import("./pages/Presentations"));
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FlutedGlass>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route element={<AppShell />}>
            <Route path="/overview" element={<Navigate to="/council" replace />} />
            <Route path="/customer" element={<Customer />} />
            <Route path="/market" element={<Market />} />
            <Route path="/competitor" element={<Competitor />} />
            <Route path="/council" element={<Council />} />
            <Route path="/decisions" element={<Decisions />} />
            <Route path="/presentations" element={<Presentations />} />
            <Route path="/presentations/:id" element={<Presentations />} />
            <Route path="/audit" element={<Navigate to="/council" replace />} />
          </Route>
          <Route
            path="*"
            element={
              <div className="not-found">
                <h1>Let’s get you back on course.</h1>
                <p>This page isn’t part of the workspace.</p>
                <Link to="/">Return to BMW NEXT →</Link>
              </div>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </FlutedGlass>
  </StrictMode>,
);
