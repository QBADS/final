import { Panel, TransactionTable } from "@qbads/ui";
import { fetchInstitutionDetail } from "../lib/apiClient";
import { usePoll } from "../lib/useApi";
import { EMPTY_DETAIL } from "../lib/emptyState";
import { recentTransactions } from "../lib/derive";

export function TransactionHistory() {
  const detail = usePoll(fetchInstitutionDetail, 4000, EMPTY_DETAIL);
  const rows = recentTransactions(detail.transactions, detail.decisions, 500);

  return (
    <Panel title="Transaction history" subtitle={`${rows.length} submitted, all time this session`} bodyClassName="!pt-1">
      <TransactionTable rows={rows} />
    </Panel>
  );
}
