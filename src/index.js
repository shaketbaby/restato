import { createStore } from "./store/index.js";

import {
  store as reactStore,
  createStore as createReactStore
} from "./bindings/react.js";

export { createStore, createReactStore, reactStore };
