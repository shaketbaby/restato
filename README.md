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

Since action is just a normal function, an action can call another
action just like any function. This makes it easy to reuse codes.

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

A common requirement for writing tests for UI components is to initialise store to a certain state. That can be done easily by dispatching a special action that set store to the expected state.
```javascript
test("Counter", async (t) => {
  // initialise store to required state
  dispatch((state) => state.count = 0);

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
