// Binding for using store with React.js
import { useState, useEffect } from "react";
import { createStore } from "../store/index.js";
import { inherit } from "../store/utils.js";

function createReactStore(initState) {
  const store = createStore(initState);

  return inherit(store, {
    useSelector(selector, isSame = Object.is) {
      const [value, setValue] = useState(store.select(selector));

      useEffect(
        () => store.subscribe(state => {
          const newValue = selector(state);
          setValue(v => isSame(v, newValue) ? v : newValue);
        }),
        [selector, isSame]
      );

      return value;
    },
  });
}

// default global store
const reactStore = createReactStore();
const { dispatch, select, useSelector } = reactStore;

export {
  createReactStore as createStore,
  reactStore as store,
  useSelector,
  dispatch,
  select,
};
