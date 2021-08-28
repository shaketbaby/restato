import { createProxy } from "./proxy.js";

export function createStore(initState = {}) {
  // actions to be triggered
  let pendingActions = [];

  // listeners to be called after changes are committed
  let selectors = []; // external listeners
  let commitListeners = []; // internal listeners

  // current committed state
  let state = initState;
  // latest state, including uncommitted changes
  let latest = state;
  // a copy on write proxy reflects latest state
  let latestProxy = createProxy(latest, onCopied, whenCommitted);

  // external store interface
  return {
    dispatch: ifNotDestroyed.bind((action, ...args) => {
      // enqueue the action to trigger later instead of immediately
      // so that actions dispatched almost at same time are batched
      pendingActions.push([action, args]);
      schedule(pendingActionsCount, triggerActions);
    }),

    select: ifNotDestroyed.bind((selector) => {
      return selector(state);
    }),

    subscribe: ifNotDestroyed.bind((selector) => {
      selectors.push(selector);

      // return an unsub function
      return () => {
        selectors = selectors?.filter(fn => fn !== selector);
      };
    }),

    destory() {
      latestProxy?.revoke?.();
      latestProxy = latest = state = null;
      pendingActions = selectors = commitListeners = null;
    }
  };

  // internal implementations
  function ifNotDestroyed(...args) {
    if (!selectors) {
      throw new Error("Store has been destroyed!");
    }
    return this(...args);
  }

  function getLatest() {
    return latest;
  }

  function onCopied(copy) {
    latest = copy;
    schedule(getLatest, commitChanges);
  }

  function whenCommitted(listener) {
    commitListeners.push(listener);
  }

  function pendingActionsCount() {
    return pendingActions.length;
  }

  function triggerActions() {
    commitChanges(); // flush uncommitted changes if any
    if (pendingActions) { // run if store is not destroyed
      pendingActions.forEach(
        ([action, args]) => callIgnoreError(action, latestProxy.proxy, ...args)
      );
      pendingActions = [];
    }
  }

  function commitChanges() {
    if (state !== latest && commitListeners) { // run if store is not destroyed
      // commit changes
      state = latest;
      // notify internal listeners that changes have been committed
      commitListeners.forEach(listener => listener());
      // clear and interested parties need to register again
      commitListeners = [];
      // notify external listeners
      selectors.forEach(selector => callIgnoreError(selector, state));
    }
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
}
