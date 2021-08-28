import { copy, getTypeOf, inherit, needsProxy } from "./utils.js";

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

  const { proxy, revoke } = Proxy.revocable(
    isMap ? mapTarget() : target,
    isMap ? {} : objectHandler()
  );
  return Object.freeze({
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
    setTarget(t) { target = t; }
  });

  // internal implementation

  function mapTarget() {
    return inherit(Map.prototype, {
      size: { get: () => target.size },
      has: (key) => target.has(key),
      get: (key) => getChild(key),
      set(key, value) {
        setChild(key, value);
        return this; // return map proxy
      },
      delete(key) {
        return target.has(key) && mutate(() => {
          const r = target.delete(key);
          deleteChild(key);
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
      // won't be able to get same value if key is mutated
      keys: () => target.keys(),
      values() {
        const iter = this.keys();
        return inherit(iter, {
          next() {
            const r = iter.next();
            const { done, value } = r;
            return done ? r : { done, value: getChild(value) };
          }
        });
      },
      entries() {
        const iter = this.keys();
        return inherit(iter, {
          next() {
            const r = iter.next();
            const { done, value } = r;
            return done ? r : { done, value: [value, getChild(value)] };
          }
        });
      },
      [Symbol.iterator]() {
        return this.entries();
      },
      forEach(cb, cbThis) {
        target.forEach((_, key) => cb.call(cbThis, getChild(key), key, this));
      }
    });
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
        return mutate((target) => {
          delete target[prop];
          deleteChild(prop);
          return true;
        });
      },

      defineProperty(_, prop, descriptor) {
        return mutate((target) => Reflect.defineProperty(target, prop, descriptor));
      },

      has(_, prop) {
        return Reflect.has(target, prop);
      },

      ownKeys() {
        return Reflect.ownKeys(target);
      },

      getOwnPropertyDescriptor(_, prop) {
        return Reflect.getOwnPropertyDescriptor(target, prop);
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
        return mutate((target) => Reflect.setPrototypeOf(target, proto));
      }
    };
  }

  function getChild(key) {
    // create proxy if hasn't already
    let child = proxyChildren.get(key);
    if (!child) {
      const value = isMap ? target.get(key) : target[key];
      child = createProxy(value, (v) => setChild(key, v), whenCommitted);
      if (child.revoke) {
        proxyChildren.set(key, child);
      }
    }
    return child.proxy;
  }

  function setChild(key, value) {
    return mutate(() => {
      // need to delete and revoke old proxy if type has changed
      // for example, if prop changed from Array to Object
      // Array.isArray() will still return true for old proxy
      const oldValue = isMap ? target.get(key) : target[key];
      const oldType = getTypeOf(oldValue);
      const newType = getTypeOf(value);
      if (oldType !== newType) {
        deleteChild(key);
      }
      // update prop value
      if (isMap) {
        target.set(key, value);
      } else {
        target[key] = value;
      }
      // update target of child proxy
      proxyChildren.get(key)?.setTarget(value);
      return true;
    });
  }

  function deleteChild(key) {
    const child = proxyChildren.get(key);
    if (child) {
      child.revoke();
      proxyChildren.delete(key);
    }
  }

  function mutate(doMutate) {
    if (!mutated) {
      // reset after committed as new changes need to be bubbled up again
      whenCommitted(() => { mutated = false });
    }

    // make a copy if hasn't mutated
    const shouldCopy = !mutated;
    if (shouldCopy) {
      target = copy(target);
    }

    const result = doMutate(target);

    if (shouldCopy) {
      onCopied(target);
    }

    mutated = true;
    return result;
  }
}
