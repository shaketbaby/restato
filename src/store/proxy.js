import { deepFreeze, getTypeOf, noop, shallowCopy } from "./utils.js";

const proxySymbol = Symbol("proxy");

const setGet = (_, key) => key;
const setAdd = (target, _, value) => target.add(value);
const mapGet = (target, key) => target.get(key);
const mapHas = (target, key) => target.has(key);
const mapDelete = (target, key) => target.delete(key);
const mapSet = (target, key, value) => target.set(key, value);

/**
 * Create a new proxy which traps all interactions with the target.
 * When proxy is mutated, it doesn't mutate target but creates a copy instead.
 */
export function createProxy(initTarget, initParent) {
  const [handler, Surrogate, getProp, setProp, hasProp, deleteProp] = {
    "object": [objectHandler, Object, Reflect.get, Reflect.set, Reflect.has, Reflect.deleteProperty],
    "array":  [objectHandler, Array,  Reflect.get, Reflect.set, Reflect.has, Reflect.deleteProperty],
    "map":    [mapHandler,    Map,    mapGet,      mapSet,      mapHas,      mapDelete],
    "set":    [setHandler,    Set,    setGet,      undefined,   mapHas,      mapDelete],
    "date":   [dateHandler,   Date],
  }[getTypeOf(initTarget)] || "";

  if (!handler) {
    return { proxy: initTarget };
  }

  let mutated = false;
  let target = initTarget;
  let parent = initParent;
  const proxyChildren = new Map();

  const self = {
    proxy: new Proxy(new Surrogate(), handler()),
    setParent(p) {
      if (p !== parent) {
        // detach from existing parent first
        parent?.detach();
        // attch to new parent
        if (parent = p) {
          parent.onCopied(target);
        }
      }
    },
    getTarget: () => target,
    // used by parent to pass in latest target on refresh request
    setTarget(t) {
      if (t !== target) {
        // go through each child proxy, if
        // - their value has changed
        // - removed from set
        // detach child proxy
        proxyChildren.forEach((child, key) => {
          if (!hasProp(t, key)) {
            deleteChildProxy(key, child);
          } else {
            const newValue = getProp(t, key);
            const oldValue = getProp(target, key);
            if (newValue !== oldValue) {
              if (getTypeOf(newValue) !== getTypeOf(oldValue)) {
                // detach existing proxy if type has changed
                deleteChildProxy(key, child);
              } else {
                // propagate changes to child
                child.setTarget(newValue);
              }
            }
          }
        });
        // update target
        target = t;
      }
    },
    // called by parent after changes are committed
    commit() {
      proxyChildren.forEach(child => child.commit());
      commit();
    }
  };
  return self;

  // internal implementation

  function dateHandler() {
    const dateMethods = {};
    Reflect.ownKeys(Date.prototype).forEach(key => {
      const isSet = key.startsWith?.("set");
      dateMethods[key] = (...args) => {
        refreshTarget();
        const execute = () => target[key].apply(target, args);
        return isSet ? mutate(execute) : execute();
      }
    });
    // do not override special ones
    dateMethods.constructor = Date.prototype.constructor;
    return { get: proxyAwareGetTrap((prop) => dateMethods[prop]) };
  }

  function mapHandler() {
    const mapMethods = {
      get size() { return refreshTarget().size },
      has: (key) => refreshTarget().has(key),
      get: (key) => getChild(key),
      set(key, value) {
        setChild(key, value);
        return this; // return map proxy
      },
      delete: (key) => deleteChild(key),
      clear() { clearChildren(); },
      // no need to proxy map keys
      keys: () => refreshTarget().keys(),
      values() {
        function next() {
          const r = Object.getPrototypeOf(this).next.call(this);
          const { done, value } = r;
          return done ? r : { done, value: getChild(value) };
        }
        return Object.freeze(
          Object.defineProperty(this.keys(), "next", { value: next })
        );
      },
      entries() {
        function next() {
          const r = Object.getPrototypeOf(this).next.call(this);
          const { done, value } = r;
          return done ? r : { done, value: [value, getChild(value)] };
        };
        return Object.freeze(
          Object.defineProperty(this.keys(), "next", { value: next })
        );
      },
      [Symbol.iterator]() {
        return this.entries();
      },
      forEach(cb, cbThis) {
        refreshTarget().forEach((_, key) => cb.call(cbThis, getChild(key), key, this));
      }
    };
    return { get: proxyAwareGetTrap((prop) => mapMethods[prop]) };
  }

  function setHandler() {
    const setMethods = {
      get size() {
        return refreshTarget().size
      },
      has: (value) => refreshTarget().has(value),
      add(value) {
        addChild(value);
        return this; // return set proxy
      },
      delete: (value) => deleteChild(value),
      clear() { clearChildren(); },
      keys() {
        return this.values()
      },
      values() {
        function next() {
          const r = Object.getPrototypeOf(this).next.call(this);
          const { done, value } = r;
          return done ? r : { done, value: getChild(value) };
        }
        return Object.freeze(
          Object.defineProperty(refreshTarget().values(), "next", { value: next })
        );
      },
      entries() {
        const it = this.values();
        return Object.freeze({
          [Symbol.iterator]: () => this.entries(),
          next() {
            const r = it.next();
            const { done, value } = r;
            return done ? r : { done, value: [value, value] };
          }
        });
      },
      [Symbol.iterator]() {
        return this.entries();
      },
      forEach(cb, cbThis) {
        const it = this.values();
        for (let n = it.next(); !n.done; n = it.next()) {
          cb.call(cbThis, n.value, n.value, this);
        }
      }
    };
    return { get: proxyAwareGetTrap((prop) => setMethods[prop]) };
  }

  function objectHandler() {
    return {
      get: proxyAwareGetTrap(prop => getChild(prop)),

      set(_, prop, value, receiver) {
        if (receiver !== self.proxy) {
          // value is set onto a different target
          // do not intercept and just pass through
          return Reflect.set(_, prop, value, receiver);
        }
        return setChild(prop, value);
      },

      deleteProperty: (_, prop) => deleteChild(prop),

      defineProperty(_, prop, descriptor) {
        refreshTarget();
        return mutate(() => Reflect.defineProperty(target, prop, descriptor));
      },

      has: (_, prop) => Reflect.has(refreshTarget(), prop),

      ownKeys: () => Reflect.ownKeys(refreshTarget()),

      getOwnPropertyDescriptor: (t, prop) => ({
        ...Reflect.getOwnPropertyDescriptor(refreshTarget(), prop),
        // eveything on proxy is mutable
        configurable: true,
        writable: true,
        // unless this is a special prop
        ...Reflect.getOwnPropertyDescriptor(t, prop)
      }),

      isExtensible: () => Reflect.isExtensible(refreshTarget()),

      preventExtensions: () => Reflect.preventExtensions(refreshTarget()),

      getPrototypeOf: (_) => Reflect.getPrototypeOf(refreshTarget()),

      setPrototypeOf(_, proto) {
        const same = proto === Reflect.getPrototypeOf(refreshTarget());
        return same || mutate(() => Reflect.setPrototypeOf(target, proto));
      }
    };
  }

  // common helpers

  function proxyAwareGetTrap(get) {
    return (_, prop) => prop === proxySymbol ? self : get(prop);
  }

  // request to refresh to make sure target is up to date
  // this should be a noop in most of the time;
  // required in async action as the latest state may have
  // been mutated by other actions
  function refreshTarget() {
    !mutated && parent?.refresh();
    return target;
  }

  function getChild(key) {
    // create proxy if hasn't already
    let child = proxyChildren.get(key);
    if (!child) {
      refreshTarget();
      child = adoptOrCreateChild(key);
    }
    return child.proxy;
  }

  function setChild(key, value) {
    const newValue = proxify(value);
    // newValue may not be a proxy if value
    // - is simple value like string or
    // - does not contain proxy
    if (isProxy(newValue)) {
      const child = newValue[proxySymbol];
      // ignore if same proxy is set back
      if (proxyChildren.get(key) !== child) {
        adoptOrCreateChild(key, child);
      }
    } else {
      const oldValue = getProp(refreshTarget(), key);
      oldValue !== value && mutate(() => {
        // detach old proxy
        deleteChildProxy(key);
        return setProp(target, key, newValue);
      });
    }
    return true;
  }

  function addChild(value) {
    if (!refreshTarget().has(value)) {
      const newValue = proxify(value);
      // newValue may not be a proxy if value
      // - is simple value like string or
      // - does not contain proxy
      if (isProxy(newValue)) {
        const child = newValue[proxySymbol];
        const key = child.getTarget();
        // ignore if same proxy is added back
        if (proxyChildren.get(key) !== child) {
          adoptOrCreateChild(key, child);
          target.add(key);
        }
      } else {
        mutate(() => target.add(newValue));
      }
    }
  }

  function adoptOrCreateChild(key, child) {
    const childParent = {
      detach: () => proxyChildren.delete(key),
      refresh: () => parent?.refresh(),
      onCopied: !(target instanceof Set)
        ? (newVal) => mutate(() => setProp(target, key, newVal))
        : (newVal) => {
          // Set doesn't support updating an item in place unfortunately
          // need to make a copy when item turns into mutated state
          mutated = false;
          mutate(noop, (v) => {
            // update child proxy mapping
            if (v === key) {
              const childProxy = proxyChildren.get(v);
              if (childProxy) {
                proxyChildren.delete(v);
                // newVal is freezable so new reference won't be
                // created when it is frozen later when committed
                proxyChildren.set(newVal, childProxy);
              }
            }
            return v === key ? newVal : v;
          })
        }
    };

    let childToAdopt = child;
    // create a new child if required
    if (!child) {
      const childValue = getProp(target, key);
      childToAdopt = createProxy(childValue, childParent);
    }

    if (isProxy(childToAdopt.proxy)) {
      // set parent if child is not new
      child && childToAdopt.setParent(childParent);
      proxyChildren.set(key, childToAdopt);
    }
    return childToAdopt;
  }

  function deleteChild(key, child) {
    return hasProp(refreshTarget(), key) && mutate(() => {
      const r = deleteProp(target, key);
      deleteChildProxy(key, child);
      return r;
    });
  }

  function deleteChildProxy(key, child) {
    const kid = child || proxyChildren.get(key);
    proxyChildren.delete(key);
    kid?.setParent(null);
  }

  function clearChildren() {
    refreshTarget().size > 0 && mutate(() => {
      proxyChildren.forEach(child => child.setParent(null));
      proxyChildren.clear();
      target.clear();
    });
  }

  function mutate(doMutate, copyItem) {
    const shouldCopy = !mutated;
    if (shouldCopy) {
      mutated = true;
      // make a copy if hasn't mutated
      // do not mutate committed target
      target = shallowCopy(target, copyItem);
    }

    const result = doMutate();

    if (shouldCopy) {
      parent?.onCopied(target);
    }
    return result;
  }

  // target can not be mutated in place after each commit
  // all new changes need to be made on a new copy and
  // need to be bubbled up again
  function commit() {
    if (mutated) {
      mutated = false
      deepFreeze(target, true);
    }
  }
}

function isProxy(value) {
  return value?.[proxySymbol];
}

function proxify(value) {
  if (isProxy(value)) {
    return value;
  }

  let proxy;
  // only need to shallow freeze value here
  // content will be frozen as they are visited
  const frozen = deepFreeze(value, true);
  // lazy creating proxy only if needed
  const getProxy = () => proxy || (proxy = createProxy(frozen).proxy);
  // adopt child proxy deteced
  const handle = (k, v, addOrSet) => {
    const child = proxify(v);
    //
    (isProxy(child) || child !== v) && addOrSet(getProxy(), k, child);
  }
  // deep detect proxy child and freeze along the way
  switch(getTypeOf(frozen)) {
    case "object":
      Reflect.ownKeys(frozen).forEach(k => handle(k, frozen[k], Reflect.set));
      break;
    case "array":
      frozen.forEach((v, k) => handle(k, v, Reflect.set));
      break;
    case "map":
      frozen.forEach((v, k) => handle(k, v, mapSet));
      break;
    case "set":
      frozen.forEach((v, k) => handle(k, v, setAdd));
      break;
    default:
  }
  return proxy || frozen;
}
