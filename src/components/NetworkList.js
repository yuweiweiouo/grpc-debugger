import React from "react";
import { useSelector, useDispatch } from "react-redux";
import AutoSizer from "react-virtualized-auto-sizer";
import { FixedSizeList as List } from "react-window";
import { selectLogEntry } from "../state/network";
import MethodIcon from "./MethodIcon";
import "./NetworkList.css";

function NetworkListRow({ index, style, data }) {
  const dispatch = useDispatch();
  const entry = data.log[index];
  const isSelected = data.selectedIdx === index;

  if (!entry) return null;

  const handleClick = () => {
    dispatch(selectLogEntry(index));
  };

  const statusClass = getStatusClass(entry);

  return (
    <div
      style={style}
      className={`network-row ${isSelected ? "selected" : ""} ${statusClass}`}
      onClick={handleClick}
    >
      <div className="network-cell status-cell">
        <MethodIcon methodType={entry.methodType} hasError={!!entry.error} />
      </div>
      <div className="network-cell name-cell" title={entry.method}>
        {entry.endpoint || entry.method}
      </div>
      <div className="network-cell status-code-cell">
        {entry.grpcStatus !== null && entry.grpcStatus !== undefined
          ? entry.grpcStatus
          : entry.httpStatus || ""}
      </div>
      <div className="network-cell duration-cell">
        {entry.duration ? `${entry.duration}ms` : ""}
      </div>
      <div className="network-cell size-cell">
        {entry.size ? formatSize(entry.size) : ""}
      </div>
    </div>
  );
}

function getStatusClass(entry) {
  if (entry.error) return "error";
  if (entry.grpcStatus !== null && entry.grpcStatus !== undefined) {
    return entry.grpcStatus === 0 ? "success" : "error";
  }
  if (entry.httpStatus) {
    return entry.httpStatus >= 200 && entry.httpStatus < 300 ? "success" : "error";
  }
  return "";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function NetworkList() {
  const log = useSelector((state) => state.network.log);
  const selectedIdx = useSelector((state) => state.network.selectedIdx);

  return (
    <div className="network-list">
      <div className="network-header">
        <div className="network-header-cell status-cell"></div>
        <div className="network-header-cell name-cell">Name</div>
        <div className="network-header-cell status-code-cell">Status</div>
        <div className="network-header-cell duration-cell">Time</div>
        <div className="network-header-cell size-cell">Size</div>
      </div>
      <div className="network-body">
        <AutoSizer>
          {({ height, width }) => (
            <List
              height={height}
              width={width}
              itemCount={log.length}
              itemSize={24}
              itemData={{ log, selectedIdx }}
            >
              {NetworkListRow}
            </List>
          )}
        </AutoSizer>
      </div>
    </div>
  );
}

export default NetworkList;
