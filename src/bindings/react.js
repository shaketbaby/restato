// Binding for using store with React.js
import { useState, useEffect } from "react";
import { createStore } from "../store/index.js";

function createReactStore(initState) {
  const store = createStore(initState);

  const reactStore = {
    useSelector(selector) {
      const [value, setValue] = useState(store.select(selector));

      useEffect(() => store.subscribe(state => setValue(selector(state))), []);

      return value;
    },
  };

  return Object.setPrototypeOf(reactStore, store);
}

// default global store
const globalStore = createReactStore();
const { dispatch, select, useSelector } = globalStore;

export { 
  createReactStore as createStore,
  globalStore as store,
  useSelector,
  dispatch,
  select,
};
