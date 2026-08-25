import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import App from "./App";
import { Overview } from "./pages/Overview";
import { TransactionHistory } from "./pages/TransactionHistory";
import { FraudRisk } from "./pages/FraudRisk";
import { ApiCredentials } from "./pages/ApiCredentials";
import { NodeConnection } from "./pages/NodeConnection";
import { FeedbackPage } from "./pages/FeedbackPage";
import { Settings } from "./pages/Settings";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<Overview />} />
          <Route path="transactions" element={<TransactionHistory />} />
          <Route path="fraud" element={<FraudRisk />} />
          <Route path="api" element={<ApiCredentials />} />
          <Route path="connection" element={<NodeConnection />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
