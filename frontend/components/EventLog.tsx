import React from "react";
import { EventLog as UIEventLog } from "./ui/event-log";
import type { LogEntryData } from "./ui/log-entry";

export type { LogEntryData } from "./ui/log-entry";

export interface EventLogProps {
  logs: LogEntryData[];
  isSignerRunning: boolean;
  onClearLogs: () => void;
  onDownload?: () => void;
  downloading?: boolean;
  hideHeader?: boolean;
  autoExpandTypes?: string[];
  onLoadOlder?: () => void;
  hasMore?: boolean;
  loadingOlder?: boolean;
}

export const EventLog: React.FC<EventLogProps> = ({
  logs,
  isSignerRunning,
  onClearLogs,
  onDownload,
  downloading,
  hideHeader,
  autoExpandTypes,
  onLoadOlder,
  hasMore,
  loadingOlder
}) => {
  return (
    <UIEventLog
      logs={logs}
      isSignerRunning={isSignerRunning}
      onClearLogs={onClearLogs}
      onDownload={onDownload}
      downloading={downloading}
      hideHeader={hideHeader}
      autoExpandTypes={autoExpandTypes}
      onLoadOlder={onLoadOlder}
      hasMore={hasMore}
      loadingOlder={loadingOlder}
    />
  );
};
