import React from "react";
import { EventLog as UIEventLog } from "./ui/event-log";
import type { LogEntryData } from "./ui/log-entry";

export type { LogEntryData } from "./ui/log-entry";

export interface EventLogProps {
  logs: LogEntryData[];
  isSignerRunning: boolean;
  onClearLogs: () => void;
  hideHeader?: boolean;
}

export const EventLog: React.FC<EventLogProps> = ({ logs, isSignerRunning, onClearLogs, hideHeader }) => {
  return (
    <UIEventLog
      logs={logs}
      isSignerRunning={isSignerRunning}
      onClearLogs={onClearLogs}
      hideHeader={hideHeader}
    />
  );
}; 
