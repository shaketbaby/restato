import { createProxy } from "./proxy.js";
import { inherit, noop } from "./utils.js";

const internalSymbol = Symbol("internal");

export function createStore(initState = {}) {
  // actions to be triggered
  let pendingActions = [];

  let commitAsyncMutation = noop;
  // listeners to be called after changes are committed
  let commitListeners = []; // internal listeners
  let selectors = []; // external listeners

  let state = {
    latest: null, // latest state, including pending changes
    committed: null, // current committed state
  }

  let middlewares = [];

  const storeInner = Object.freeze({
    dispatch(action, ...args) {
      assertNotDestroyed();
      // enqueue the action to trigger later instead of immediately
      // so that actions dispatched almost at same time are batched
      pendingActions.push([action, args]);
      schedule(() => pendingActions.length, triggerActions);
    },

    getState() {
      assertNotDestroyed();
      return state.committed;
    },

    setState(newState) {
      assertNotDestroyed();
      discardChanges();
      pendingActions = []; // discard pending actions
      // update state by calling a special action, bypassing middlewares
      const action = (s, latest) => s.latest = latest;
      action[internalSymbol] = true;
      callAction(action, [newState]);
    },
  });

  // external store interface
  const store = Object.freeze(inherit(storeInner, {
    select(selector) {
      assertNotDestroyed();
      return selector(state.committed);
    },

    subscribe(selector) {
      assertNotDestroyed();
      selectors.push(selector);
      // return an unsub function
      return () => {
        selectors = selectors?.filter(fn => fn !== selector);
      };
    },

    addMiddlewares(...middlewareFactories) {
      assertNotDestroyed();
      middlewareFactories.forEach(factory => {
        const mw = factory(storeInner);
        mw && middlewares.push(mw);
      });
    },

    destroy() {
      middlewares?.forEach(mw => {
        try {
          mw.destroy?.();
        } catch (error) {
          console.error(`Error destroying middleware`, error);
        }
      });
      state = selectors = middlewares = pendingActions = commitListeners = null;
    },
  }));


  // initialise state
  storeInner.setState(initState);

  return store;

  // internal implementations

  function triggerActions() {
    // run if store is not destroyed
    if (pendingActions) {
      // commit pending changes if any
      // so that action starts with very latest state
      commitAsyncMutation();

      const batch = pendingActions;
      pendingActions = [];
      batch.forEach(([action, args]) => applyMiddleware(callAction, action, args));
    }
  }

  function callAction(action, args) {
    let isAsync;
    let proxy;

    const onCopied = (copy) => {
      state = copy;
      // commit changes across the proxy tree
      commitListeners.push(proxy.commit);
      // schedule to commit later, this is desirable because
      // multiple mutations can be made in one operation; by
      // scheduling we avoid creating unnecessary copies
      if (isAsync) {
        commitAsyncMutation = () => {
          let done = false;
          try {
            const doCommit = () => done || (commitChanges(), done = true);
            applyMiddleware(doCommit, action, args, isAsync);
          } finally {
            // discard if middlewares didn't request to commit
            done || discardChanges();
            done = true;
          }
        };
        schedule(storeInner.getState, commitAsyncMutation);
      }
    };

    const refresh = () => {
      if (selectors === null) {
        // this means store has been destroyed
        proxy.setParent(null);
        assertNotDestroyed();
      } else {
        // commit pending changes for async refresh request
        // as latest state may have been changed by others
        isAsync && commitAsyncMutation();
        proxy.setTarget(state);
      }
    };

    try {
      proxy = createProxy(state, { refresh, onCopied, detach: noop });
      // pass full state proxy if this is an internal action
      action(action[internalSymbol] ? proxy.proxy : proxy.proxy.latest, ...args);
    } finally {
      // apply mutations immediately
      commitChanges();
      isAsync = true;
    }
  }

  function applyMiddleware(doAction, action, args, isAsync, chain = middlewares[Symbol.iterator]()) {
    const { done, value: mw } = chain.next();
    if (done) {
      doAction(action, args);
    } else {
      const next = (actionMw, argsMw) => {
        const actionToUse = isAsync ? action : actionMw;
        const argsToUse = isAsync ? args : argsMw;
        applyMiddleware(doAction, actionToUse, argsToUse, isAsync, chain);
      };
      ((isAsync ? mw.asyncExecuted : mw.execute) || next)(action, args, next);
    }
  }

  function commitChanges() {
    if (state.committed !== state.latest) {
      state.committed = state.latest;
      notifyCommitListeners();
      if (selectors?.length) {
        schedule(storeInner.getState, notifySelectors);
      }
    }
  }

  function discardChanges() {
    if (state.latest !== state.committed) {
      state.latest = state.committed;
      notifyCommitListeners();
    }
  }

  function notifyCommitListeners() {
    if (commitListeners) {
      const listeners = commitListeners;
      commitListeners = [];
      // notify internal listeners that changes have been committed
      listeners.forEach(l => l());
      // clear and interested parties need to register again
    }
    commitAsyncMutation = noop;
  }

  function notifySelectors() {
    // notify external listeners if full commit
    selectors?.forEach(selector => store.select(selector));
  }

  function schedule(getGuard, fn) {
    const guard = getGuard();
    // run if there are no more changes
    queueMicrotask(() => getGuard() === guard && fn());
  }

  function assertNotDestroyed() {
    if (!selectors) {
      throw new Error("Store has been destroyed!");
    }
  }
}
