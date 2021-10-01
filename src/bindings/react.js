// Binding for using store with React.js
import { useState, useEffect, useRef } from "react";
import { createStore } from "../store/index.js";
import { inherit } from "../store/utils.js";

function createReactStore(initState) {
  const store = createStore(initState);

  return inherit(store, {
    useSelector(selector, isSame = Object.is) {
      const valueRef = useRef(store.select(selector));
      const [value, setValue] = useState(valueRef.current);

      useEffect(
        () => store.subscribe(state => {
          const newValue = selector(state);
          if (!isSame(valueRef.current, newValue)) {
            setValue(valueRef.current = newValue);
          }
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
