import { deepFreeze, getTypeOf, needsProxy, noop, shallowCopy, shallowFreeze } from "./utils.js";

/**
 * Create a new proxy which traps all interactions with the target.
 * When proxy is mutated, it doesn't mutate target but creates a copy instead.
 *
 * @param {Function} getLatest get the lastest value of the proxy target
 * @param {Function} onCopied callback that should be called when target is copied
 *                            for example, set or delete a property
 *                            should pass the new value as the only argument
 * @param {Function} whenCommitted callback for registering commit listeners
 *                                 called right after state changes are committed
 *                                 listeners will be deleted after called to prevent memory leak
 *                                 should register again as required
 * @returns a copy on write proxy
 */
export function createProxy(value, onCopied, whenCommitted) {
  if (!needsProxy(value)) {
    return { proxy: value };
  }

  let target = value;
  let mutated = false;
  const proxyChildren = new Map();

  const isMap = target instanceof Map;
  const isSet = target instanceof Set;
  const isDate = target instanceof Date;

  const { proxy, revoke } = Proxy.revocable(
    isDate ? new Date() : isMap ? new Map() : isSet ? new Set() : Array.isArray(target) ? [] : {},
    isDate ? dateHandler() : isMap ? mapHandler() : isSet ? setHandler() : objectHandler(),
  );
  return {
    proxy,
    // revoke self and all proxy children
    revoke() {
      proxyChildren.forEach(child => child.revoke());
      proxyChildren.clear();
      target = undefined;
      revoke();
    },
    // used by parent to pass in latest target
    // called when prop is set to a different value, e.g.
    // - parent[target] = newValue
    // - parentMap.set(target, newValue)
    setTarget(t) {
      // go through each child proxy, if their value has changed
      // then revoke child proxies if any of the follow is true
      //  - type of their target has changed
      //  - their target doesn't exist anymore
      // otherwise update child target
      proxyChildren.forEach((child, key) => {
        if (isSet) {
          // delete if key doesn't exist in the new set
          t.has(key) || deleteChildProxy(key, child);
        } else {
          const newValue = isMap ? t.get(key) : t[key];
          const oldValue = isMap ? target.get(key) : target[key];
          if(newValue !== oldValue) {
            if (getTypeOf(newValue) === getTypeOf(oldValue)) {
              child.setTarget(newValue);
            } else {
              deleteChildProxy(key, child);
            }
          }
        }
      });
      // update target
      target = t;
    }
  };

  // internal implementation

  function dateHandler() {
    const dateMethods = {};
    Reflect.ownKeys(Date.prototype).forEach(key => {
      const isSet = key.startsWith?.("set");
      dateMethods[key] = (...args) => {
        const execute = () => target[key].apply(target, args);
        return isSet ? mutate(execute) : execute();
      }
    });
    // do not override special ones
    dateMethods.constructor = Date.prototype.constructor;
    return { get: (_, prop) => dateMethods[prop] };
  }

  function mapHandler() {
    const mapMethods = {
      get size() { return target.size },
      has: (key) => target.has(key),
      get: (key) => getChild(key),
      set(key, value) {
        setChild(key, value);
        return this; // return map proxy
      },
      delete(key) {
        return target.has(key) && mutate(() => {
          const r = target.delete(key);
          deleteChildProxy(key);
          return r;
        });
      },
      clear() {
        target.size > 0 && mutate(() => {
          proxyChildren.forEach(child => child.revoke());
          proxyChildren.clear();
          target.clear();
        });
      },
      // no need to proxy map keys
      keys: () => target.keys(),
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
        target.forEach((_, key) => cb.call(cbThis, getChild(key), key, this));
      }
    };
    return { get: (_, prop) => mapMethods[prop] };
  }

  function setHandler() {
    const setMethods = {
      get size() { return target.size },
      has: (value) => target.has(value),
      add(value) {
        target.has(value) || mutate(() => target.add(deepFreeze(value)));
        return this; // return set proxy
      },
      delete(value) {
        return target.has(value) && mutate(() => {
          const r = target.delete(value);
          deleteChildProxy(value);
          return r;
        });
      },
      clear() {
        target.size > 0 && mutate(() => {
          proxyChildren.forEach(child => child.revoke());
          proxyChildren.clear();
          target.clear();
        });
      },
      keys() {
        return this.values()
      },
      values() {
        function next() {
          const r = Object.getPrototypeOf(this).next.call(this);
          const { done, value } = r;
          return done ? r : {
            done,
            value: getChild(value, (newVal) => mutate(noop, (v) => {
              // update child proxy mapping
              if (v === value) {
                const child = proxyChildren.get(v);
                proxyChildren.delete(v);
                // newVal is freezable so new reference won't be
                // created when it is frozen later when committed
                proxyChildren.set(newVal, child);
              }
              return v === value ? newVal : v;
            }))
          };
        }
        return Object.freeze(
          Object.defineProperty(target.values(), "next", { value: next })
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
    return { get: (_, prop) => setMethods[prop] };
  }

  function objectHandler() {
    return {
      get(_, prop) {
        return getChild(prop);
      },

      set(_, prop, value, receiver) {
        if (receiver !== proxy) {
          // value is set onto a different target
          // do not intercept and just pass through
          return Reflect.set(_, prop, value, receiver);
        }
        return setChild(prop, value);
      },

      deleteProperty(_, prop) {
        return !Reflect.has(target, prop) || mutate(() => {
          const r = Reflect.deleteProperty(target, prop);
          r && deleteChildProxy(prop);
          return r;
        });
      },

      defineProperty(_, prop, descriptor) {
        return mutate(() => Reflect.defineProperty(target, prop, descriptor));
      },

      has(_, prop) {
        return Reflect.has(target, prop);
      },

      ownKeys() {
        return Reflect.ownKeys(target);
      },

      getOwnPropertyDescriptor(t, prop) {
        const ret = {
          ...Reflect.getOwnPropertyDescriptor(target, prop),
          // eveything on proxy is mutable
          configurable: true,
          writable: true,
          // unless this is a special prop
          ...Reflect.getOwnPropertyDescriptor(t, prop)
        };
        return ret;
      },

      isExtensible() {
        return Reflect.isExtensible(target);
      },

      preventExtensions() {
        return Reflect.preventExtensions(target);
      },

      getPrototypeOf(_) {
        return Reflect.getPrototypeOf(target);
      },

      setPrototypeOf(_, proto) {
        const same = proto === Reflect.getPrototypeOf(target);
        return same || mutate(() => Reflect.setPrototypeOf(target, proto));
      }
    };
  }

  function getChild(key, onChildCopied = (v) => setChild(key, v, true)) {
    // create proxy if hasn't already
    let child = proxyChildren.get(key);
    if (!child) {
      const value = isSet ? key : (isMap ? target.get(key) : target[key]);
      child = createProxy(value, onChildCopied, whenCommitted);
      if (child.revoke) {
        proxyChildren.set(key, child);
      }
    }
    return child.proxy;
  }

  function setChild(key, value, isBubbledUp) {
    const oldValue = isMap ? target.get(key) : target[key];
    return oldValue === value || mutate(() => {
      // need to delete and revoke old proxy if type has changed
      // for example, if prop changed from Array to Object
      // Array.isArray() will still return true for old proxy
      if (getTypeOf(oldValue) !== getTypeOf(value)) {
        deleteChildProxy(key);
      }

      // freeze if value is not coming from child
      // as there might be further mutations
      const newValue = isBubbledUp ? value : deepFreeze(value);

      // update prop value
      if (isMap) {
        target.set(key, newValue);
      } else {
        target[key] = newValue;
      }
      // update target of child proxy if set is not from child
      if (!isBubbledUp) {
        proxyChildren.get(key)?.setTarget(newValue);
      }
      return true;
    });
  }

  function deleteChildProxy(key, child) {
    const kid = child || proxyChildren.get(key);
    if (kid) {
      kid.revoke();
      proxyChildren.delete(key);
    }
  }

  function mutate(doMutate, copyItem) {
    if (!mutated) {
      // request to be notified on first mutation
      whenCommitted(commit);

      // make a copy if hasn't mutated
      // do not mutate committed target
      target = shallowCopy(target, copyItem);
    }

    const result = doMutate();

    if (!mutated) {
      onCopied(target);
    }

    mutated = true;
    return result;
  }

  // target can not be mutated in place after each commit
  // all new changes need to be made on a new copy and
  // need to be bubbled up again
  function commit() {
    if (mutated) {
      mutated = false
      // freeze target if not revoked
      target && shallowFreeze(target);
    }
  }
}

