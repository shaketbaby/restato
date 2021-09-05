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

  t.test("can not be used after calling destroy", (tt) => {
    tt.plan(4);

    const store = createStore({});

    let proxy;
    store.dispatch(state => proxy = state);

    Promise.resolve().then(() => {
      store.destory()

      // proxy can not be used again
      tt.throws(() => proxy.foo, /Cannot perform 'get' on a proxy that has been revoked/);
      // all methods on store throws
      const noop = () => void 0;
      const error = new Error("Store has been destroyed!");
      tt.throws(() => store.subscribe(noop), error);
      tt.throws(() => store.dispatch(noop), error);
      tt.throws(() => store.select(noop), error);
    });
  });
});
