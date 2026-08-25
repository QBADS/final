import type { Institution } from "@qbads/types";
import type { InstitutionDetail, NodeStatus } from "./apiClient";
import { NODE_INSTITUTION_ID } from "./apiClient";

const PLACEHOLDER_INSTITUTION: Institution = {
  id: NODE_INSTITUTION_ID,
  name: "Loading…",
  kind: "fintech",
  region: "—",
  fabricOrgId: "—",
  status: "offline",
  syncHealthPct: 0,
  connectedSince: new Date().toISOString(),
  lastEventAt: new Date().toISOString(),
};

export const EMPTY_DETAIL: InstitutionDetail = {
  institution: PLACEHOLDER_INSTITUTION,
  transactions: [],
  decisions: [],
  feedback: [],
};

export const EMPTY_STATUS: NodeStatus = {
  institution: PLACEHOLDER_INSTITUTION,
  requestsToday: 0,
  lastEventAt: null,
};
