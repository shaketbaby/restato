# restato

A minimal but very flexible and powerful store inspired by Redux.

# Install

restato can be installed using either `npm` or `yarn`

```bash
npm install restato
```

```bash
yarn add restato
```

# Usages

- [Store](#store)
- [Action](#action)
- [Selector](#selector)
- [Middlewares](#middlewares)
- [Bindings](#bindings)
- [Testing](#testing)

## Store

States are managed by a store.

New store can be created by calling `createStore` with initial state.

```javascript
import { createStore } from "restato";

// initState object will be deeply frozen after createStore() returns;
// any mutation attempts will fail, either silently or by throwing a
// TypeError exception (most commonly, but not exclusively, when in strict mode).
const initState = {};
const store = createStore(initState);
const { dispatch, select, subscribe } = store;
```

## Access state

State can't be accessed directly, need to
- dispatch an `action` to mutate state
- use a `selector` to read state

## Action

Action is used to make changes to the state.

An action is just a function that is called by the store with the current state as the first argument.

State passed in can be mutated in place. Store will manage the mutations and apply them to a copy of the state when it's done.

Actions are dispatched asynchronously and multiple actions may be batched and be processed together.

It's recommened to group actions by feature and put into a folder. Each action should have a name which will be used as the type by the Redux DevTools middleware. See below middleware section for details.

```javascript
// get dispatch form a store object
const { dispatch } = store;

// a simple action
// first parameter is always state
// extra parameter may be passed if specified when calling dispatch
function updateFoo(state, value) => {
  state.foo = value;
}
// disatch action updateFoo
// action must be the first argument
// extra arguments will be passed through to action as is
dispatch(updateFoo, "bar");


// action can also be async
async function asyncAction(state) {
  state.isFetching = true;

  // send request to server
  doFetch().then(value => {
    // update state after response comes back
    state.foo = value;
    state.isFetching = false;
  });
}
dispatch(asyncAction);
```

Since action is just a normal function, an action can call another action just like any function. This makes it easy to reuse codes.

```javascript
function actionOne(state) {
  // do something
}

function actionTwo(state) {
  ... // stuff
  actionOne(state);
  ... // more stuff
}

dispatch(actionTwo);
```
_Note, when assign object and other container values like array, Map and Set to state or one of its offsprings in action, value will be frozen and no furthur mutations can be made on it directly. All changes must be done via the reference get from state_
```javascript
function action(state) {
  const obj = { key: "value" };

  // after this line, object will be frozen, variable obj can not be used any more
  // any mutation attempts will fail, either silently or by throwing a
  // TypeError exception (most commonly, but not exclusively, when in strict mode).
  state.obj = obj;

  const key = obj.key; // read is still ok
  obj.foo = "bar"; // either ignore silently or throw error

  state.obj.foo = "bar"; // Ok

  // use a reference returned from state
  const stateObj = state.obj;
  stateObj.foo = "bar"; // Ok

}
```

## Selector

Selector is used to read state out of store.

Similar to action, a selector is just a function that is called with current state as the only parameter.

Selecor should only read from state. Everything returned from selector is frozen, any mutation attempts will fail, either silently or by throwing a TypeError exception (most commonly, but not exclusively, when in strict mode).


```javascript
// get dispatch form a store object
const { select, subscribe } = store;

const selector = (state) => state.foo;

// call select to select once immediately
// return value is what's returned from selector
const foo = select(selector);

// can also subscribe the selector
// selector will be called after state is changed by action
// calling the returned function will unsubscribe selector
const unsub = subscribe(selector);

unsub(); // selector won't be called on state changes
```

## Middlewares

Middleware can be used to tap into the action dispatching and state mutating flow. For example, to delay the dispatching, or even stop the dispatching, etc.

Middlewares can be registered with `store.addMiddlewares(middleware1, middleware1, ...)` method.

A middleware factory function should be passed to `addMiddlewares`. This function will be called with a `store` that has `getState()`, `setState(newState)` and `dispatch(action, ...args)` methods. It should return an object with 3 methods: `execute(action, args, next)`, `asyncExecuted(action, args, next)` and `destroy()`. All 3 methods are optional and is called at various point of an action's lifecyle.

The middlewares are applied in the same order as they are added. The first one will be given the original action and args passed to `store.dispatch()`; it is expected to call `next(action, args)`, with either the original action & args or a different one, to pass the control to next middleware; this is repeated until the last middleware where the action will be executed when `next(action, args)` is called.

```javascript
const loggerMiddleware = ({
  getState, // get current state
  setState, // set new state immediately
  dispatch  // dispatch an action as normal
}) => {
  return {
    // execute is called when an action is about to be executed
    // this can be an async function if needed to say delay the dispatch
    execute(action, args, next) {
      console.log("pre dispatch", action.name, getState());

      // passing action and args to next middleware
      // action dispatching will stop if next() is not called
      // can just pass the provided action & args or a new action as needed
      // aciton will be executed if this is the last middle in the chain
      next(action, args);

      console.log("post dispatch", action.name, getState());
    },

    // asyncExecuted is called after state is mutated by an action's async codes
    // for example, in the callback passed to "promise.then".
    // calling next() synchronously indicates mutations should be committed;
    // mutations will be discarded if next()
    // - is not called or
    // - is called asynchronously later
    asyncExecuted(action, args, next) {
      console.log("async operation");

      // calls next middleware in the chain
      // mutations will be discarded if next() is not called
      next();
    }

    // called when store is being destroyed
    destroy() {
      // do any clean up required
    }
  };
};

store.addMiddlewares(logger);
```

### Dispatch additional actions

Middlewares can dispatch additional actions during initialisation, in `execute` or `asyncExecuted` by calling `dispatch()` on the passed in `store` object. These actions will go through the middleware chain like a normal action. Since actions are dispatched asynchronously, the order of dispatching is indeterministic.

### Redux DevTools

A middleware is provided for connecting to Redux DevTools extension.
```javascript
import reduxDevTools from "restato/middlewares/redux-devtools";
// below if bundler doesn't support Subpath exports
// see https://nodejs.org/api/packages.html#packages_subpath_exports
//
// import { reduxDevToolsMiddleware } from "restato";

store.addMiddlewares(reduxDevTools(/* options */));
```
Redux DevTools expect action to have a `type` string. This middleware will use action function's name as type. If action doesn't have a name, `/anonymous` will be used. For async mutations, `/async` suffix will be appended to differentiate with synchronous mutations from the same action.

![Redux DevTools Middleware](https://raw.githubusercontent.com/shaketbaby/restato/main/src/middlewares/redux-devtools.gif)

## Bindings

To help with using restato, following bindings have been provided.

### React

React binding is a thin wrapper around the store. It provides a `useSelector` hook for using in UI component.

```javascript
// below requires a bundler that supports Subpath exports, see https://nodejs.org/api/packages.html#packages_subpath_exports
// for bundlers that don't support subpath exports, need to do
//
// import { reactStore } from "restato";
// const { dispatch, useSelector } = reactStore;
//
import { dispatch, useSelector } from "restato/react";

function Counter() {
  const count = useSelector((state) => state.count || 0);
  const increase = (state) => {
    const { count } = state;
    state.count = count ? count + 1 : 1;
  };
  return <button onClick={() => dispatch(increase)}>{count}</button>;
}
```

Above example uses the `dispatch` and `useSelector` from the default global store. You can also create a local store if the global one is not suitable.
```javascript
// for bundlers don't support subpath exports, do
// import { createReactStore as createStore } from "restato";
import { createStore } from "restato/react";

const store = createStore();
...
```

## Testing

A common requirement for writing tests for UI components is to initialise store to a certain state. That can be done easily by calling `store.setState()` to set store to the required state.

```javascript
test("Counter", async (t) => {
  // initialise store to required state
  store.setState({ count: 0 });

  // then render component
  render(<Counter/>);

  // assertions
  expect(...);
});
```

# Note

## Frozen Map, Set, Date, etc

As mentioned above, object managed by store is frozen to prevent accidental mutating.

For values like normal object and array, this can be done easily with `Object.freeze()`; but is a different story for other type of object like instances of Map, Set, Date and potentially other types. Objects of these types are special as they are just a wrapper, real value is hidden inside. `Object.freeze()` only freezes the wrapper. Their internal state can still be accessed by using the methods available the type's prototype object.
```javascript
const map = new Map();

// this only freezes the wrapper object
Object.freeze(map);

// internal state can still be manipulated
Map.prototype.set.call(map, "key", "value");
```
It seems monkey patching the prototype is the only way to work around this. But that may introduce more problem than it solves.

Because of this, the frozen version of these objects are special in that they are only look like an instance of those types. They have all the methods avialble on the type but can't be used as receiver to call functions from those prototypes.
```javascript
function someAction(state) {
  state.map = new Map(Object.entries({ key: "value" }));

  // can be accessed like normal Map
  state.map instanceof Map; // true
  state.map.get("key") === "value";
  state.map.set("key", "new value");

  // will throw error
  Map.prototype.get.call(state.map);
  Map.prototype.set.call(state.map);
}
```
This should be fine in most of the cases and if these objects are used as receiver by some library to call the functions of those prototype, error will be thrown to let client know. We feel this is better than letting the object gets mutated silently. As that could introduce unexpected behaviour and is very hard to debug.
