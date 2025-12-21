import { createSlice } from "@reduxjs/toolkit";

const schemaSlice = createSlice({
  name: "schema",
  initialState: {
    loaded: false,
    loading: false,
    services: [],
    lastLoadedFile: null,
    error: null,
    reflectionStatus: null, // 'loading' | 'success' | 'failed' | null
    reflectionServer: null,
    reflectionError: null,
  },
  reducers: {
    setLoading(state, action) {
      state.loading = action.payload;
    },
    setSchemaLoaded(state, action) {
      const { fileName, services } = action.payload;
      state.loaded = true;
      state.loading = false;
      state.lastLoadedFile = fileName;
      state.error = null;

      for (const service of services) {
        const existing = state.services.find(
          (s) => s.fullName === service.fullName
        );
        if (!existing) {
          state.services.push(service);
        }
      }
    },
    setSchemaError(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
    removeService(state, action) {
      const { fileName } = action.payload;
      state.services = state.services.filter((s) => s.fileName !== fileName);
      if (state.services.length === 0) {
        state.loaded = false;
      }
    },
    clearAllSchemas(state) {
      state.loaded = false;
      state.loading = false;
      state.services = [];
      state.lastLoadedFile = null;
      state.error = null;
      state.reflectionStatus = null;
      state.reflectionServer = null;
      state.reflectionError = null;
    },
    setReflectionLoading(state, action) {
      state.reflectionStatus = "loading";
      state.reflectionServer = action.payload;
      state.reflectionError = null;
    },
    setReflectionSuccess(state, action) {
      state.reflectionStatus = "success";
      state.reflectionServer = action.payload.server;
      state.reflectionError = null;

      for (const service of action.payload.services || []) {
        const existing = state.services.find(
          (s) => s.fullName === service.fullName
        );
        if (!existing) {
          state.services.push(service);
        }
      }
      state.loaded = true;
    },
    setReflectionFailed(state, action) {
      state.reflectionStatus = "failed";
      state.reflectionError = action.payload;
    },
  },
});

const { actions, reducer } = schemaSlice;
export const {
  setLoading,
  setSchemaLoaded,
  setSchemaError,
  removeService,
  clearAllSchemas,
  setReflectionLoading,
  setReflectionSuccess,
  setReflectionFailed,
} = actions;

export default reducer;

