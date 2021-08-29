# restato

A minimal and flexible store inspired by Redux.

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

## Selector

Selector is used to read state out of store.

Similar to action, a selector is just a function that is called with current state as the only parameter.

Selecor should only read from state.

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
import { createStore } from "restato/react";

const store = createStore();
...
```

## Testing

A common requirement for writing tests for UI components is to initialise store to a certain state. That can be done easily by dispatching a special action that set store to the expected state.
