import { createProxy } from "./proxy.js";
import { deepFreeze, inherit, noop } from "./utils.js";

export function createStore(initState = {}) {
  // actions to be triggered
  let pendingActions = [];

  let commitAsyncMutation = noop;
  // listeners to be called after changes are committed
  let commitListeners = []; // internal listeners
  let selectors = []; // external listeners

  // current committed state
  let state = deepFreeze(initState);
  // latest state, including pending changes
  let latest = state;

  let middlewares = [];

  const storeInner = Object.freeze({
    dispatch(action, ...args) {
      assertNotDestroyed();
      // enqueue the action to trigger later instead of immediately
      // so that actions dispatched almost at same time are batched
      pendingActions.push([action, args]);
      schedule(pendingActionsCount, triggerActions);
    },

    getState() {
      assertNotDestroyed();
      return state;
    },

    setState(newState) {
      assertNotDestroyed();
      discardChanges();
      state = latest = deepFreeze(newState);
      schedule(storeInner.getState, notifySelectors);
    },
  });

  // external store interface
  return Object.freeze(inherit(storeInner, {
    select(selector) {
      assertNotDestroyed();
      return selector(state);
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
      middlewares?.forEach(mw => mw.destroy && callIgnoreError(mw.destroy));
      latest = state = selectors = middlewares = pendingActions = commitListeners = null;
    },
  }));

  // internal implementations
  function triggerActions() {
    // run if store is not destroyed
    if (pendingActions) {
      // commit pending changes if any
      // so that action starts with very latest state
      commitAsyncMutation();

      const batch = pendingActions;
      pendingActions = [];
      batch.forEach(([action, args]) => {
        applyMiddleware(callAction, action, args);
      });
    }
  }

  function callAction(action, args) {
    let isAsync;
    let proxy;

    const onCopied = (copy) => {
      latest = copy;
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
        proxy.revoke();
        assertNotDestroyed();
      } else {
        // commit pending changes for async refresh request
        // as latest state may have been changed by others
        isAsync && commitAsyncMutation();
        proxy.setTarget(latest);
      }
    };

    try {
      proxy = createProxy(latest, onCopied, whenCommitted, refresh);
      action(proxy.proxy, ...args);
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
    if (state !== latest) {
      state = latest;
      notifyCommitListeners();
      schedule(storeInner.getState, notifySelectors);
    }
  }

  function discardChanges() {
    if (latest !== state) {
      latest = state;
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
    selectors?.forEach(selector => callIgnoreError(selector, state));
  }

  function schedule(getGuard, fn) {
    Promise.resolve(getGuard()).then(old => {
      // run if there are no more changes
      getGuard() === old && fn();
    })
  }

  function callIgnoreError(fn, ...args) {
    try {
      fn(...args);
    } catch (error) {
      // we don't handle error, print a warning to notify app developers
      console.error(
        `Error calling function `, error,
        `\n function: `, fn,
        `\narguments: `, args
      );
    }
  }

  function assertNotDestroyed() {
    if (!selectors) {
      throw new Error("Store has been destroyed!");
    }
  }

  function whenCommitted(listener) {
    commitListeners.push(listener);
  }

  function pendingActionsCount() {
    return pendingActions.length;
  }
}
