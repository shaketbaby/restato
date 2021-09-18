import test from "tape";

import { createStore } from "./store.js";

test("store", (t) => {
  t.test("can select value", (tt) => {
    tt.plan(2);

    const store = createStore({ key: "value" });
    const value = store.select(state => state.key);
    tt.equal(value, "value");
    tt.throws(() => value.err = "throws", /Cannot create property 'err' on string 'value'/);
  });

  t.test("can be changed by disptaching actions", (tt) => {
    tt.plan(2);

    const action = (state, value) => {
      state.dispatched = value;
    };

    const selector = state => state.dispatched;

    const store = createStore({ key: "value" });
    store.dispatch(action, "dispatched value");

    // action is dispatched asynchronously
    tt.equal(store.select(selector), undefined);
    // select again in next tick should get value
    setTimeout(() => {
      tt.equal(store.select(selector), "dispatched value")
    });
  });

  t.test("supports async action", (tt) => {
    tt.plan(4);

    let serverResolve;
    const serverPromise = new Promise(resolve => serverResolve = resolve);

    let actionResolve;
    const actionPromise = new Promise(resolve => actionResolve = resolve);

    const action = (state) => {
      state.sync = true;

      const { nested } = state;
      nested.fetching = true;

      // mimic async operations
      serverPromise.then(() => {
        state.sync = false;
        nested.fetching = false;

        actionResolve(); // resolve action promise
      });
    };

    const store = createStore({ nested: { fetching: false } });
    store.dispatch(action);

    // sync mutation first
    setTimeout(() => {
      const state = store.select(state => state);
      tt.equal(state.sync, true);
      tt.equal(state.nested.fetching, true);

      serverResolve(); // resolve server promise
    });

    // async mutation comes later
    actionPromise.then(() => {
      const state = store.select(state => state);
      tt.equal(state.sync, false);
      tt.equal(state.nested.fetching, false);
    });
  });

  t.test("notifies subscribed listeners on change", (tt) => {
    tt.plan(2);

    const store = createStore({});
    store.subscribe(state => tt.equal(state.selector1, "selector1"));
    store.subscribe(state => tt.equal(state.selector2, "selector2"));
    store.dispatch((state) => {
      state.selector1 = 'selector1';
      state.selector2 = "selector2";
    })
  });

  t.test("does not notify unsubscribed listeners", (tt) => {
    tt.plan(1);

    let notified;

    const store = createStore({});
    const unsub = store.subscribe(() => notified = "selector1");
    store.subscribe(() => notified = "selector2");
    store.dispatch((state) => state.changed = true);

    unsub();

    setTimeout(() => tt.equal(notified, "selector2"));
  });

  t.test("batches actions dispatched in same sync execution", (tt) => {
    tt.plan(1);

    const counts = { action: 0, notified: 0 }

    const store = createStore({});
    store.subscribe((state) => {
      counts.notified += 1
      counts.action = state.count;
    });
    store.dispatch((state) => state.count = (counts.action += 1));
    store.dispatch((state) => state.count = `${counts.action += 1}`);

    setTimeout(() => tt.deepEqual(counts, { action: '2', notified: 1 }));
  });

  t.test("different actions can change same state", (tt) => {
    tt.plan(2);

    let state;

    let asyncResolve;
    const asyncPromise = new Promise(resolve => asyncResolve = resolve);

    function asyncAction(state) {
      const { asyncObject } = state;

      syncAction(state);

      asyncPromise.then(() => {
        state.updated += 1;
        state.syncObject.async = true;
        asyncObject.updated += 1;
      });
    }

    function syncAction(state, resolve) {
      state.updated += 1;
      if (resolve) {
        resolve();
        state.syncObject = {};
      } else {
        state.asyncObject.updated += 1;
      }
    };

    const store = createStore({ updated: 0, asyncObject: { updated: 0 } });
    store.subscribe((s) => state = s);
    store.dispatch(asyncAction);
    // dispatch syncAction after asyncAction is triggered
    setTimeout(() => {
      tt.equal(store.select(state => state.updated), 1);
      store.dispatch(syncAction, asyncResolve);
    });
    // assert final state is correct
    setTimeout(() => tt.deepEqual(state, {
      updated: 3,
      asyncObject: { updated: 2 },
      syncObject: { async: true },
    }));
  });

  t.test("supports adding middlewares", (tt) => {
    tt.plan(1);

    const store = createStore({ count: 0 });

    const middlewareCalls = [];

    store.addMiddlewares(({ getState }) => ({
      execute(action, args, next) {
        middlewareCalls.push({ name: "before execute", action, args, state: getState() });
        next(action, args);
        middlewareCalls.push({ name: "after execute", action, args, state: getState() });
      },

      asyncExecuted(action, args, next) {
        middlewareCalls.push({ name: "before asyncExecuted", action, args, state: getState() });
        next();
        middlewareCalls.push({ name: "after asyncExecuted", action, args, state: getState() });
      },

      destroy() {
        middlewareCalls.push({ name: "destroy", state: getState() });
      }
    }));

    let testResolve;
    const testPromise = new Promise(resolve => testResolve = resolve);

    function increase(state, count) {
      state.count = count + 1;
      setTimeout(() => {
        state.count++;
        setTimeout(testResolve)
      });
    }

    store.dispatch(increase, store.getState().count);

    testPromise.then(() => {
      store.destroy();

      tt.deepEqual(middlewareCalls, [
        { name: "before execute", action: increase, args: [0], state: { count: 0 } },
        { name: "after execute", action: increase, args: [0], state: { count: 1 } },
        { name: "before asyncExecuted", action: increase, args: [0], state: { count: 1 } },
        { name: "after asyncExecuted", action: increase, args: [0], state: { count: 2 } },
        { name: "destroy", state: { count: 2 } },
      ]);
    });
  });

  t.test("calls middlewares in the order they are added", (tt) => {
    tt.plan(2);

    const middlewareCalls = [];

    const store = createStore();

    store.addMiddlewares(
      () => ({
        execute(action, args, next) {
          middlewareCalls.push("middleware 1 before execute");
          next(action, args);
          middlewareCalls.push("middleware 1 after execute");
        },

        asyncExecuted(action, args, next) {
          middlewareCalls.push("middleware 1 before asyncExecuted");
          next();
          middlewareCalls.push("middleware 1 after asyncExecuted");
        }
      }),
      () => ({
        execute(action, args, next) {
          middlewareCalls.push("middleware 2 before execute");
          next(action, args);
          middlewareCalls.push("middleware 2 after execute");
        },

        asyncExecuted(action, args, next) {
          middlewareCalls.push("middleware 2 before asyncExecuted");
          next();
          middlewareCalls.push("middleware 2 after asyncExecuted");
        }
      })
    );

    let testResolve;
    const testPromise = new Promise(r => testResolve = r);

    store.dispatch((state) => Promise.resolve().then(() => {
      state.async = true;
      testResolve();
    }));

    testPromise.then(() => {
      tt.deepEqual(middlewareCalls, [
        "middleware 1 before execute",
        "middleware 2 before execute",
        "middleware 2 after execute",
        "middleware 1 after execute",
        "middleware 1 before asyncExecuted",
        "middleware 2 before asyncExecuted",
        "middleware 2 after asyncExecuted",
        "middleware 1 after asyncExecuted",
      ]);
      tt.deepEqual(store.getState(), { async: true });
    });
  });

  t.test("does not call middleware's asyncExecuted for sync action", (tt) => {
    tt.plan(2);

    const middlewareCalls = [];

    const store = createStore();
    store.addMiddlewares(() => ({
      asyncExecuted(_, __, next) {
        middlewareCalls.push("asyncExecuted");
        next();
      }
    }));

    // dispatch an sync action
    store.dispatch((state) => state.sync = true);

    setTimeout(() => {
      tt.deepEqual(middlewareCalls, []);
      tt.deepEqual(store.getState(), { sync: true });
    });
  })

  t.test("middleware can stop action dispatching in execute", (tt) => {
    tt.plan(2);

    const middlewareCalls = [];

    const store = createStore();
    store.addMiddlewares(() => ({
      execute(action, args, next) {
        // stop dispatch by not calling next(action, args)
        middlewareCalls.push("middleware 1 execute");
      },
      asyncExecuted(action, args, next) {
        middlewareCalls.push("middleware 1 execute");
        next();
      }
    }));
    store.addMiddlewares(() => ({
      execute(action, args, next) {
        middlewareCalls.push("middleware 2 execute");
        next(action, args);
      }
    }));

    store.dispatch((state) => {
      state.sync = true;
      setTimeout(() => state.async = true);
    });

    setTimeout(() => {
      tt.deepEqual(store.getState(), {});
      tt.deepEqual(middlewareCalls, ["middleware 1 execute"]);
    });
  });

  t.test("middleware can stop action dispatching in the middle of the chain", (tt) => {
    tt.plan(2);

    const middlewareCalls = [];

    const store = createStore();
    store.addMiddlewares(() => ({
      execute(action, args, next) {
        middlewareCalls.push("middleware 1 before execute");
        next(action, args)
        middlewareCalls.push("middleware 1 after execute");
      },
      asyncExecuted(action, args, next) {
        middlewareCalls.push("middleware 1 execute");
        next();
      }
    }));
    store.addMiddlewares(() => ({
      execute(action, args, next) {
        // stop dispatching
        middlewareCalls.push("middleware 2 execute");
      }
    }));

    store.dispatch((state) => {
      state.sync = true;
      setTimeout(() => state.async = true);
    });

    setTimeout(() => {
      tt.deepEqual(store.getState(), {});
      tt.deepEqual(middlewareCalls, [
        "middleware 1 before execute",
        "middleware 2 execute",
        "middleware 1 after execute",
      ]);
    });
  });

  t.test("middleware can discard async mutations", (tt) => {
    tt.plan(3);

    const middlewareCalls = [];

    const store = createStore();
    store.addMiddlewares(
      () => ({
        asyncExecuted(action, args, next) {
          // discard by not calling next()
          middlewareCalls.push("middleware 1 asyncExecuted");
        }
      }),
      () => ({
        asyncExecuted(action, args, next) {
          middlewareCalls.push("middleware 2 asyncExecuted");
          next();
        }
      })
    );

    let testResolve;
    const testPromise = new Promise(r => testResolve = r);

    let asyncMutated = false;

    store.dispatch((state) => {
      state.sync = true;
      setTimeout(() => {
        state.async = true;
        asyncMutated = true;
        setTimeout(testResolve);
      });
    });

    testPromise.then(() => {
      tt.deepEqual(asyncMutated, true);
      tt.deepEqual(store.getState(), { sync: true });
      tt.deepEqual(middlewareCalls, ["middleware 1 asyncExecuted"]);
    });
  });

  t.test("middleware can discard async mutations in the middle of the chain", (tt) => {
    tt.plan(3);

    const middlewareCalls = [];

    const store = createStore();
    store.addMiddlewares(
      () => ({
        asyncExecuted(action, args, next) {
          middlewareCalls.push("middleware 1 before asyncExecuted");
          next();
          middlewareCalls.push("middleware 1 after asyncExecuted");
        }
      }),
      () => ({
        asyncExecuted(action, args, next) {
          // discard by not calling next()
          middlewareCalls.push("middleware 2 asyncExecuted");
        }
      })
    );

    let testResolve;
    const testPromise = new Promise(r => testResolve = r);

    let asyncMutated = false;

    store.dispatch((state) => {
      state.sync = true;
      setTimeout(() => {
        state.async = true;
        asyncMutated = true;
        setTimeout(testResolve);
      });
    });

    testPromise.then(() => {
      tt.deepEqual(asyncMutated, true);
      tt.deepEqual(store.getState(), { sync: true });
      tt.deepEqual(middlewareCalls, [
        "middleware 1 before asyncExecuted",
        "middleware 2 asyncExecuted",
        "middleware 1 after asyncExecuted",
      ]);
    });
  });

  t.test("middleware can change action and args in execute", (tt) => {
    tt.plan(3);

    const middlewareCalls = [];

    let testResolve;
    const testPromise = new Promise(r => testResolve = r);

    function middlewareAction(state, key, value) {
      state[key] = value;
      setTimeout(() => {
        state[key + "Async"] = value;
        testResolve(key);
      });
    }

    function normalAction(state) {
      state.normal = true;
      setTimeout(() => {
        state.normalAsync = true;
        testResolve("normal");
      });
    }

    const store = createStore();

    store.addMiddlewares(
      () => ({
        execute(action, args, next) {
          middlewareCalls.push({ name: "middleware 1 execute", action, args });
          next(middlewareAction, ["middleware", true]);
        },
        asyncExecuted(action, args, next) {
          middlewareCalls.push({ name: "middleware 1 asyncExecuted", action, args });
          next();
        }
      }),
      () => ({
        execute(action, args, next) {
          middlewareCalls.push({ name: "middleware 2 execute", action, args });
          next(action, args);
        }
      })
    );

    store.dispatch(normalAction);

    testPromise.then((key) => {
      tt.equal(key, "middleware");
      tt.deepEqual(store.getState(), { middleware: true, middlewareAsync: true });
      tt.deepEqual(middlewareCalls, [
        { name: "middleware 1 execute", action: normalAction, args: [] },
        { name: "middleware 2 execute", action: middlewareAction, args: ["middleware", true] },
        { name: "middleware 1 asyncExecuted", action: middlewareAction, args: ["middleware", true] },
      ]);
    });
  });

  t.test("middlware can not change action and args in asyncExecuted", (tt) => {
    tt.plan(3);

    const middlewareCalls = [];

    let testResolve;
    const testPromise = new Promise(r => testResolve = r);

    function middlewareAction(state, key, value) {
      state[key] = value;
      setTimeout(() => {
        state[key + "Async"] = value;
        testResolve(key);
      });
    }

    function normalAction(state) {
      state.normal = true;
      setTimeout(() => {
        state.normalAsync = true;
        testResolve("normal");
      });
    }

    const store = createStore();

    store.addMiddlewares(
      () => ({
        asyncExecuted(action, args, next) {
          middlewareCalls.push({ name: "middleware 1 asyncExecuted", action, args });
          next(middlewareAction, ["middleware", true]);
        }
      }),
      () => ({
        asyncExecuted(action, args, next) {
          middlewareCalls.push({ name: "middleware 2 asyncExecuted", action, args });
          next();
        }
      })
    );

    store.dispatch(normalAction);

    testPromise.then((key) => {
      tt.equal(key, "normal");
      tt.deepEqual(store.getState(), { normal: true, normalAsync: true });
      tt.deepEqual(middlewareCalls, [
        { name: "middleware 1 asyncExecuted", action: normalAction, args: [] },
        { name: "middleware 2 asyncExecuted", action: normalAction, args: [] },
      ]);
    });
  });

  t.test("middleware can dispatch additional actions", (tt) => {
    tt.plan(10);

    function middlewareInitAction(state) {
      state.middlewareInit = true;
    }

    function middlewareExecuteBeforeAction(state) {
      state.middlewareExecuteBefore = true;
    }

    function middlewareExecuteAfterAction(state) {
      state.middlewareExecuteAfter = true;
      Promise.resolve().then(() => state.middlewareExecuteAsync = true);
    }

    function middlewareAsyncExecutedBeforeAction(state) {
      state.middlewareAsyncExecutedBefore = true;
      Promise.resolve().then(() => state.middlewareAsyncExecutedAsync = true);
    }

    function middlewareAsyncExecutedAfterAction(state) {
      state.middlewareAsyncExecutedAfter = true;
    }

    function normalAction(state) {
      state.normal = true;
      Promise.resolve().then(() => state.normalAsync = true);
    }

    const middlewareCalls = [];

    const store = createStore();

    store.addMiddlewares(({ dispatch }) => {
      dispatch(middlewareInitAction);
      return {
        execute(action, args, next) {
          middlewareCalls.push("execute: " + action.name);
          // dispatch conditional to prevent infinite dispatching
          if (action === normalAction) {
            dispatch(middlewareExecuteBeforeAction);
          }
          next(action, args);
          if (action === normalAction) {
            dispatch(middlewareExecuteAfterAction);
          }
        },
        asyncExecuted(action, args, next) {
          middlewareCalls.push("asyncExecuted: " + action.name);
          // dispatch conditional to prevent infinite dispatching
          if (action === normalAction) {
            dispatch(middlewareAsyncExecutedBeforeAction);
          }
          next(action, args);
          // dispatch conditional to prevent infinite dispatching
          if (action === normalAction) {
            dispatch(middlewareAsyncExecutedAfterAction);
          }
        }
      }
    });

    store.dispatch(normalAction);

    setTimeout(() => {
      tt.deepEqual(store.getState(), {
        normal: true,
        normalAsync: true,
        middlewareInit: true,
        middlewareExecuteAfter: true,
        middlewareExecuteBefore: true,
        middlewareExecuteAsync: true,
        middlewareAsyncExecutedAfter: true,
        middlewareAsyncExecutedBefore: true,
        middlewareAsyncExecutedAsync: true,
      });

      [
        normalAction,
        middlewareExecuteAfterAction,
        middlewareAsyncExecutedBeforeAction,
      ].forEach(({ name }) => {
        tt.equal(middlewareCalls.includes("asyncExecuted: " + name), true);
      });

      [
        normalAction,
        middlewareInitAction,
        middlewareExecuteBeforeAction,
        middlewareExecuteAfterAction,
        middlewareAsyncExecutedBeforeAction,
        middlewareAsyncExecutedAfterAction
      ].forEach(({ name }) => {
        tt.equal(middlewareCalls.includes("execute: " + name), true);
      });
    });
  });

  t.test("middleware can call setState to reset state", (tt) => {
    tt.plan(2);

    const store = createStore();

    store.addMiddlewares(({ setState }) => ({
      asyncExecuted(_, __, next) {
        setState({ reset: true });
        next();
      }
    }));

    let asyncMutated = false;

    store.dispatch(state => Promise.resolve().then(() => {
      state.async = true;
      asyncMutated = true;
    }));

    setTimeout(() => {
      tt.equal(asyncMutated, true);
      tt.deepEqual(store.getState(), { reset: true })
    });
  });

  t.test("can not be used after calling destroy", (tt) => {
    tt.plan(7);

    const store = createStore({});

    let proxy;
    store.dispatch(state => proxy = state);

    Promise.resolve().then(() => {
      store.destroy();

      const noop = () => void 0;
      const error = new Error("Store has been destroyed!");
      // proxy can not be used again
      tt.throws(() => proxy.foo, error);
      // all methods on store throws
      tt.throws(() => store.subscribe(noop), error);
      tt.throws(() => store.dispatch(noop), error);
      tt.throws(() => store.select(noop), error);
      tt.throws(() => store.setState({}), error);
      tt.throws(() => store.getState(noop), error);
      tt.throws(() => store.addMiddlewares(() => {}), error);

      // can call again
      store.destroy();
    });
  });
});
