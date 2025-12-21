import { createSlice } from "@reduxjs/toolkit";

const toolbarSlice = createSlice({
  name: "toolbar",
  initialState: {
    filterValue: "",
  },
  reducers: {
    setFilterValue(state, action) {
      state.filterValue = action.payload;
    },
  },
});

const { actions, reducer } = toolbarSlice;
export const { setFilterValue } = actions;

export default reducer;
