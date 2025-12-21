import React, { useState } from "react";
import ReactJson from "react-json-view";
import { useSelector } from "react-redux";
import schemaManager from "../lib/schema-manager";
import "./NetworkDetails.css";

const TABS = ["Headers", "Request", "Response", "Proto"];

function NetworkDetails() {
  const [activeTab, setActiveTab] = useState("Headers");
  const entry = useSelector((state) => state.network.selectedEntry);
  const clipboardIsEnabled = useSelector(
    (state) => state.clipboard.clipboardIsEnabled
  );

  if (!entry) {
    return (
      <div className="details-empty">
        <span>Select a request to view details</span>
      </div>
    );
  }

  const theme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "twilight"
    : "rjv-default";

  const protoDef = activeTab === "Proto" ? schemaManager.getProtoDefinition(entry.method) : null;

  return (
    <div className="details-container">
      <div className="details-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`details-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="details-content">
        {activeTab === "Request" && (
          <div className="details-section">
            {entry.request ? (
              <ReactJson
                name="request"
                theme={theme}
                style={{ backgroundColor: "transparent" }}
                enableClipboard={clipboardIsEnabled}
                src={entry.request}
                collapsed={2}
              />
            ) : (
              <div className="details-empty-section">
                {entry.requestRaw ? "Unable to decode request" : "No request data"}
              </div>
            )}
          </div>
        )}

        {activeTab === "Response" && (
          <div className="details-section">
            {entry.error ? (
              <ReactJson
                name="error"
                theme={theme}
                style={{ backgroundColor: "transparent" }}
                enableClipboard={clipboardIsEnabled}
                src={entry.error}
              />
            ) : entry.response ? (
              <ReactJson
                name="response"
                theme={theme}
                style={{ backgroundColor: "transparent" }}
                enableClipboard={clipboardIsEnabled}
                src={entry.response}
                collapsed={2}
              />
            ) : (
              <div className="details-empty-section">
                {entry.responseRaw ? "Unable to decode response" : "No response data"}
              </div>
            )}
          </div>
        )}

        {activeTab === "Headers" && (
          <div className="details-section">
            <div className="headers-group">
              <h4>General</h4>
              <table className="headers-table">
                <tbody>
                  <tr>
                    <td>Method</td>
                    <td>{entry.method}</td>
                  </tr>
                  <tr>
                    <td>URL</td>
                    <td>{entry.url}</td>
                  </tr>
                  <tr>
                    <td>HTTP Status</td>
                    <td>{entry.httpStatus}</td>
                  </tr>
                  <tr>
                    <td>gRPC Status</td>
                    <td>
                      {entry.grpcStatus !== null && entry.grpcStatus !== undefined
                        ? `${entry.grpcStatus}${entry.grpcMessage ? ` - ${entry.grpcMessage}` : ""}`
                        : "N/A"}
                    </td>
                  </tr>
                  <tr>
                    <td>Duration</td>
                    <td>{entry.duration ? `${entry.duration}ms` : "N/A"}</td>
                  </tr>
                  <tr>
                    <td>Size</td>
                    <td>{entry.size ? `${entry.size} bytes` : "N/A"}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {entry.requestHeaders && Object.keys(entry.requestHeaders).length > 0 && (
              <div className="headers-group">
                <h4>Request Headers</h4>
                <table className="headers-table">
                  <tbody>
                    {Object.entries(entry.requestHeaders).map(([key, value]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {entry.responseHeaders && Object.keys(entry.responseHeaders).length > 0 && (
              <div className="headers-group">
                <h4>Response Headers</h4>
                <table className="headers-table">
                  <tbody>
                    {Object.entries(entry.responseHeaders).map(([key, value]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {entry.trailer && Object.keys(entry.trailer).length > 0 && (
              <div className="headers-group">
                <h4>Trailers</h4>
                <table className="headers-table">
                  <tbody>
                    {Object.entries(entry.trailer).map(([key, value]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "Proto" && (
          <div className="details-section">
            {protoDef ? (
              <div className="proto-details">
                <div className="headers-group">
                  <h4>Request Message: {protoDef.request.type}</h4>
                  <table className="headers-table">
                    <thead>
                      <tr>
                        <th>Number</th>
                        <th>Name</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {protoDef.request.fields.map((f) => (
                        <tr key={f.number}>
                          <td>{f.number}</td>
                          <td>{f.name}</td>
                          <td>{f.type_name || f.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="headers-group" style={{ marginTop: '20px' }}>
                  <h4>Response Message: {protoDef.response.type}</h4>
                  <table className="headers-table">
                    <thead>
                      <tr>
                        <th>Number</th>
                        <th>Name</th>
                        <th>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {protoDef.response.fields.map((f) => (
                        <tr key={f.number}>
                          <td>{f.number}</td>
                          <td>{f.name}</td>
                          <td>{f.type_name || f.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="details-empty-section">
                No Proto definition available for this method.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default NetworkDetails;
