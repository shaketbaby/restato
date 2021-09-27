import { freeze, toFreezable } from "./freezable.js";

export const noop = () => {};

export const identity = v => v;

export const inherit = (base, obj) => Object.setPrototypeOf(obj, base);

export function getTypeOf(value) {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (value instanceof Date) {
    return "date";
  }
  if (value instanceof Number) {
    return "number";
  }
  if (value instanceof String) {
    return "string";
  }
  if (value instanceof Boolean) {
    return "boolean";
  }
  if (value instanceof Map) {
    return "map";
  }
  if (value instanceof Set) {
    return "set";
  }
  return typeof(value);
}

export function shallowCopy(value, copyItem = identity) {
  if (Array.isArray(value)) {
    const len = value.length;
    const arr = new Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = copyItem(value[i]);
    }
    return arr;
  }

  if (value instanceof Date) {
    return toFreezable(new Date(value.getTime()));
  }

  if (value instanceof Map) {
    const map = new Map();
    value.forEach((v, k) => map.set(k, copyItem(v)));
    return toFreezable(map);
  }

  if (value instanceof Set) {
    const set = new Set();
    value.forEach((v) => set.add(copyItem(v)));
    return toFreezable(set);
  }

  // normal object
  const obj = Object.create(Object.getPrototypeOf(value));
  Reflect.ownKeys(value).forEach(k => obj[k] = copyItem(value[k]));
  return obj;
}

export function deepFreeze(value, shallow) {
  let frozen = value;
  // only freeze if necessary
  if (!Object.isFrozen(frozen)) {
    switch (getTypeOf(frozen)) {
      case "object":
        if (!shallow) {
          Reflect.ownKeys(frozen).forEach(key => {
            frozen[key] = deepFreeze(frozen[key]);
          });
        }
        freeze(frozen);
        break;
      case "array":
        if (!shallow) {
          for (let i = 0; i < frozen.length; i++) {
            frozen[i] = deepFreeze(frozen[i]);
          }
        }
        freeze(frozen);
        break;
      case "date":
        frozen = freeze(toFreezable(frozen));
        break;
      case "map":
      case "set":
        frozen = freezeCollection(frozen, shallow);
        break;
      default:
    }
  }
  return frozen;
}

function freezeCollection(collection, shallow) {
  let frozen = collection;
  if (!shallow) {
    // since we can't update Set value like Map
    // need to keep a copy of all frozen values
    // so if any frozen value is different to original
    // we can make copy the final frozen collection
    const isSet = frozen instanceof Set;
    const setCopy = isSet && new Set();
    let hasDiff = false;
    frozen.forEach((value, key, coll) => {
      const newVal = deepFreeze(value);
      if (isSet) {
        setCopy.add(newVal);
      }
      if (newVal !== value) {
        hasDiff = true;
        if (!isSet) {
          coll.set(key, newVal);
        }
      }
    });
    if (isSet && hasDiff) {
      frozen = setCopy;
    }
  }
  // freeze collection
  return freeze(toFreezable(frozen));
}
