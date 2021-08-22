function copy(target) {
  const proto = Object.getPrototypeOf(target);
  return Object.assign(Object.create(proto), target);
}

function getTypeOf(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (value instanceof Date) {
    return "date";
  }
  return typeof (value);
}

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
  let mutated = false;
  let target = value;
  const proxiedProps = new Map();

  try {
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

    function deleteProxy(prop) {
      const child = proxiedProps.get(prop);
      if (child) {
        child.revoke();
        proxiedProps.delete(prop);
      }
    }

    const { proxy, revoke } = Proxy.revocable(target, {
      apply(fn, fnTthis, args) {
        return Reflect.apply(fn, fnTthis, args);
      },

      get(_, prop, receiver) {
        // create proxy if hasn't already
        let child = proxiedProps.get(prop);
        if (!child) {
          child = createProxy(
            Reflect.get(target, prop, receiver),
            (value) => this.set(_, prop, value, proxy),
            whenCommitted
          );
          if (child.revoke) {
            proxiedProps.set(prop, child);
          }
        }
        return child.proxy;
      },

      set(_, prop, value, receiver) {
        if (receiver !== proxy) {
          return Reflect.set(_, prop, value, receiver);
        }
        return mutate((target) => {
          // need to delete and revoke old proxy if type has changed
          // for example, if prop changed from Array to Object
          // Array.isArray() will still return true for old proxy
          const oldType = getTypeOf(target[prop]);
          const newType = getTypeOf(value);
          if (oldType !== newType) {
            deleteProxy(prop);
          }
          // update prop value
          target[prop] = value;
          // update target of child proxy
          proxiedProps.get(prop)?.setTarget(value);
          return true;
        });
      },

      deleteProperty(_, prop) {
        return mutate((target) => {
          delete target[prop];
          deleteProxy(prop);
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
    });

    // revoke self and all proxy children
    const deepRevoke = () => {
      proxiedProps.forEach(child => child.revoke());
      proxiedProps.clear();
      revoke();
    };

    return { proxy, revoke: deepRevoke, setTarget(t) { target = t; } };
  } catch (error) {
    // ignore, target is a primitive value
  }

  return { proxy: target };
}
