import { createSlice } from "@reduxjs/toolkit";
import Fuse from "fuse.js";
import { setFilterValue } from "./toolbar";
import {
  decodeGrpcWebFrame,
  decodeProtobufRaw,
  formatDecodedMessage,
  decodeTrailer,
} from "../lib/protobuf-decoder";
import schemaManager from "../lib/schema-manager";

const fuseOptions = {
  shouldSort: false,
  threshold: 0.1,
  distance: 10000,
  keys: ["method", "endpoint"],
};

const fuse = new Fuse([], fuseOptions);

function processRawData(entry) {
  let methodInfo = schemaManager.getMethodInfo(entry.method);

  console.log("[gRPC Debugger] Processing:", entry.method, "methodInfo:", methodInfo);

  // Try reflection if no schema found
  if (!methodInfo && entry.url) {
    schemaManager.tryReflection(entry.url).then((success) => {
      if (success) {
        console.log("[gRPC Debugger] Reflection succeeded, schema now available");
      }
    });
  }

  if (entry.requestRaw && !entry.request) {
    try {
      const frames = decodeGrpcWebFrame(entry.requestRaw, entry.requestBase64Encoded !== false);
      if (frames.length > 0 && !frames[0].isTrailer) {
        const decoded = decodeProtobufRaw(frames[0].payload);
        if (methodInfo?.requestMessage) {
          entry.request = schemaManager.applyFieldNames(decoded, methodInfo.requestMessage);
        } else {
          entry.request = formatDecodedMessage(decoded);
        }
      }
    } catch (e) {
      entry.request = { _decodeError: e.message };
    }
  }

  if (entry.responseRaw && !entry.response) {
    try {
      const frames = decodeGrpcWebFrame(entry.responseRaw, entry.responseBase64Encoded !== false);
      const responses = [];
      let trailer = null;

      for (const frame of frames) {
        if (frame.isTrailer) {
          trailer = decodeTrailer(frame.payload);
        } else {
          const decoded = decodeProtobufRaw(frame.payload);
          if (methodInfo?.responseMessage) {
            responses.push(schemaManager.applyFieldNames(decoded, methodInfo.responseMessage));
          } else {
            responses.push(formatDecodedMessage(decoded));
          }
        }
      }

      if (responses.length === 1) {
        entry.response = responses[0];
      } else if (responses.length > 1) {
        entry.response = responses;
        entry.methodType = "server_streaming";
      }

      if (trailer) {
        entry.trailer = trailer;
        if (trailer["grpc-status"]) {
          entry.grpcStatus = parseInt(trailer["grpc-status"], 10);
        }
        if (trailer["grpc-message"]) {
          entry.grpcMessage = decodeURIComponent(trailer["grpc-message"]);
        }
      }
    } catch (e) {
      entry.response = { _decodeError: e.message };
    }
  }

  return entry;
}

const networkSlice = createSlice({
  name: "network",
  initialState: {
    preserveLog: false,
    selectedIdx: null,
    selectedEntry: null,
    log: [],
    _filterValue: "",
    _logBak: [],
  },
  reducers: {
    networkLog(state, action) {
      const { log, _filterValue, _logBak } = state;
      let { payload } = action;

      // Ignore frontend hook messages (they no longer send request data)
      if (payload.source === "frontend_hook") {
        return;
      }

      if (payload.method) {
        const parts = payload.method.split("/");
        payload.endpoint = parts.pop() || parts.pop();
      }

      payload = processRawData(payload);

      if (_filterValue.length > 0) {
        _logBak.push(payload);
        fuse.setCollection(_logBak);
        state.log = fuse.search(_filterValue).map((r) => r.item);
      } else {
        log.push(payload);
      }
    },
    selectLogEntry(state, action) {
      const { payload: idx } = action;
      const entry = state.log[idx];
      if (entry) {
        state.selectedIdx = idx;
        state.selectedEntry = entry;
      }
    },
    clearLog(state, action) {
      const { payload: { force } = {} } = action;
      if (state.preserveLog && !force) {
        return;
      }
      state.selectedIdx = null;
      state.selectedEntry = null;
      state.log = [];
      state._logBak = [];
    },
    setPreserveLog(state, action) {
      const { payload } = action;
      state.preserveLog = payload;
    },
    reprocessLog(state) {
      // Reprocess all log entries to apply field names after schema is loaded
      state.log = state.log.map((entry) => {
        const reprocessed = { ...entry };
        
        // Clear existing decoded data to force reprocessing
        delete reprocessed.request;
        delete reprocessed.response;
        
        return processRawData(reprocessed);
      });
      
      // Also reprocess backup log
      if (state._logBak.length > 0) {
        state._logBak = state._logBak.map((entry) => {
          const reprocessed = { ...entry };
          delete reprocessed.request;
          delete reprocessed.response;
          return processRawData(reprocessed);
        });
      }
      
      // Update selected entry if exists
      if (state.selectedIdx !== null && state.log[state.selectedIdx]) {
        state.selectedEntry = state.log[state.selectedIdx];
      }
    },
  },
  extraReducers: (builder) => {
    builder.addCase(setFilterValue, (state, action) => {
      const { payload: filterValue = "" } = action;
      state._filterValue = filterValue;

      if (filterValue.length === 0) {
        state.log = state._logBak;
        state._logBak = [];
        return;
      }

      if (state._logBak.length === 0 && state.log.length !== 0) {
        state._logBak = state.log;
      }

      fuse.setCollection(state._logBak);
      state.log = fuse.search(filterValue).map((r) => r.item);
    });
  },
});

const { actions, reducer } = networkSlice;
export const { networkLog, selectLogEntry, clearLog, setPreserveLog, reprocessLog } = actions;

export default reducer;
