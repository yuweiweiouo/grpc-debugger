import React from "react";
import "./NetworkEmpty.css";

function NetworkEmpty() {
  const modifier = navigator.platform.indexOf("Mac") === 0 ? "⌘" : "Ctrl";

  return (
    <div className="network-empty">
      <div className="content">
        <div className="title">Recording gRPC network activity...</div>
        <div className="subtitle">
          Perform a request or hit <strong>{modifier} R</strong> to record the reload
        </div>
      </div>
    </div>
  );
}

export default NetworkEmpty;
