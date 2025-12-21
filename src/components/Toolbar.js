import React, { useCallback, useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { clearLog, setPreserveLog } from "../state/network";
import { setFilterValue } from "../state/toolbar";
import {
  setSchemaLoaded,
} from "../state/schema";
import schemaManager from "../lib/schema-manager";
import ClearIcon from "../icons/Clear";
import ProtoIcon from "../icons/ProtoIcon";
import "./Toolbar.css";

function Toolbar() {
  const dispatch = useDispatch();
  const filterInputRef = useRef(null);
  const [showSchemaList, setShowSchemaList] = useState(false);

  const preserveLog = useSelector((state) => state.network.preserveLog);
  const schemaState = useSelector((state) => state.schema);

  const handleFilterKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") {
        dispatch(setFilterValue(""));
        if (filterInputRef.current) {
          filterInputRef.current.value = "";
        }
      }
    },
    [dispatch]
  );

  const handleFilterChange = useCallback(
    (e) => {
      dispatch(setFilterValue(e.target.value));
    },
    [dispatch]
  );

  const handleClearLog = useCallback(() => {
    dispatch(clearLog({ force: true }));
  }, [dispatch]);

  const handlePreserveLogChange = useCallback(
    (e) => {
      dispatch(setPreserveLog(e.target.checked));
    },
    [dispatch]
  );

  const handleSchemaListToggle = useCallback(() => {
    setShowSchemaList(!showSchemaList);
  }, [showSchemaList]);

  const handleClearSchemas = useCallback(async () => {
    if (window.confirm("Clear all loaded schemas (including Reflection results)?")) {
      await schemaManager.clearAll();
      dispatch(setSchemaLoaded({ fileName: "", services: [] }));
      setShowSchemaList(false);
    }
  }, [dispatch]);

  const getStatusText = () => {
    if (schemaState.loading) return "Loading...";
    if (schemaState.reflectionStatus === "loading") return "Auto-detecting...";

    const count = schemaState.services.length;
    if (count > 0) {
      return `${count} service(s)`;
    }

    return "No Schema";
  };

  const getStatusClass = () => {
    if (schemaState.reflectionStatus === "success") return "reflection-success";
    if (schemaState.reflectionStatus === "failed") return "reflection-failed";
    return "";
  };

  const getLoadedSchemas = () => {
    const schemas = [];
    for (const [name, schema] of schemaManager.schemas) {
      schemas.push({
        name: name.startsWith("reflection:") ? name.replace("reflection:", "🔍 ") : `📜 ${name}`,
        serviceCount: schema.services?.length || 0,
        messageCount: Object.keys(schema.messages || {}).length,
      });
    }
    return schemas;
  };

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button
          className="toolbar-button"
          onClick={handleClearLog}
          title="Clear log"
        >
          <ClearIcon />
        </button>

        <div className="toolbar-separator" />

        <input
          ref={filterInputRef}
          className="toolbar-input"
          type="text"
          placeholder="Filter"
          onKeyDown={handleFilterKeyDown}
          onChange={handleFilterChange}
        />

        <div className="toolbar-separator" />

        <label className="toolbar-checkbox">
          <input
            type="checkbox"
            checked={preserveLog}
            onChange={handlePreserveLogChange}
          />
          Preserve log
        </label>
      </div>

      <div className="toolbar-right">
        <button
          className={`toolbar-button proto-button ${getStatusClass()}`}
          onClick={handleSchemaListToggle}
          title="Show schema list"
        >
          <ProtoIcon />
          <span className="proto-button-text">{getStatusText()}</span>
        </button>

        {schemaState.reflectionStatus === "loading" && (
          <span className="reflection-loading" title="Attempting auto-reflection...">
            ⏳
          </span>
        )}

        {(schemaState.error || schemaState.reflectionError) && (
          <span
            className="toolbar-error"
            title={schemaState.error || schemaState.reflectionError}
          >
            ⚠️
          </span>
        )}
      </div>

      {showSchemaList && (
        <div className="schema-list-dropdown">
          <div className="schema-list-header">
            <span>Loaded Schemas</span>
            <div className="schema-header-actions">
              <button onClick={handleClearSchemas} title="Clear all schemas" style={{ marginRight: '8px', fontSize: '10px' }}>
                🗑️ Clear
              </button>
              <button onClick={handleSchemaListToggle}>✕</button>
            </div>
          </div>
          <div className="schema-list-content">
            {getLoadedSchemas().length === 0 ? (
              <div className="schema-list-empty">No schemas loaded</div>
            ) : (
              getLoadedSchemas().map((schema, idx) => (
                <div key={idx} className="schema-list-item">
                  <span className="schema-name">{schema.name}</span>
                  <span className="schema-stats">
                    {schema.serviceCount} svc, {schema.messageCount} msg
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Toolbar;
