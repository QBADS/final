import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import App from "./App";
import { Overview } from "./pages/Overview";
import { LiveMonitoring } from "./pages/LiveMonitoring";
import { KpiAnalytics } from "./pages/KpiAnalytics";
import { InstitutionsByKind } from "./pages/InstitutionsByKind";
import { TransactionCentre } from "./pages/TransactionCentre";
import { FraudDetectionPage } from "./pages/FraudDetectionPage";
import { CaseManagement } from "./pages/CaseManagement";
import { AiMl } from "./pages/AiMl";
import { QuantumComputing } from "./pages/QuantumComputing";
import { BlockchainPage } from "./pages/BlockchainPage";
import { FeatureEngineering } from "./pages/FeatureEngineering";
import { ApiGatewayPage } from "./pages/ApiGatewayPage";
import { SecurityOperations } from "./pages/SecurityOperations";
import { Reports } from "./pages/Reports";
import { Administration } from "./pages/Administration";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<Overview />} />
          <Route path="live-monitoring" element={<LiveMonitoring />} />
          <Route path="kpi-analytics" element={<KpiAnalytics />} />
          <Route path="institutions/banks" element={<InstitutionsByKind kinds={["bank"]} label="Connected banks" />} />
          <Route path="institutions/fintechs" element={<InstitutionsByKind kinds={["fintech", "digital_wallet", "mobile_money"]} label="Fintechs & wallets" />} />
          <Route path="institutions/processors" element={<InstitutionsByKind kinds={["payment_processor"]} label="Payment processors" />} />
          <Route path="institutions/exchanges" element={<InstitutionsByKind kinds={["crypto_exchange"]} label="Crypto exchanges" />} />
          <Route path="operations/transactions" element={<TransactionCentre />} />
          <Route path="operations/fraud" element={<FraudDetectionPage />} />
          <Route path="operations/cases" element={<CaseManagement />} />
          <Route path="intelligence/ai-ml" element={<AiMl />} />
          <Route path="intelligence/quantum" element={<QuantumComputing />} />
          <Route path="intelligence/blockchain" element={<BlockchainPage />} />
          <Route path="intelligence/feature-engineering" element={<FeatureEngineering />} />
          <Route path="platform/api-gateway" element={<ApiGatewayPage />} />
          <Route path="platform/security" element={<SecurityOperations />} />
          <Route path="platform/reports" element={<Reports />} />
          <Route path="platform/admin" element={<Administration />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
