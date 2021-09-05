export const symbols = {
  proxy: Symbol("proxy"),
  freezable: Symbol("freezable"),
};

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
  return typeof (value);
}

export function needsProxy(value) {
  switch (getTypeOf(value)) {
    case "object":
    case "array":
    case "map":
      return true;
  }
  return false;
}

export function copy(value) {
  if (Array.isArray(value)) {
    return value.slice();
  }

  if (value instanceof Map) {
    return toFreezableCollection(new Map(value));
  }

  if (value instanceof Set) {
    return toFreezableCollection(new Set(value));
  }

  const proto = Object.getPrototypeOf(value);
  return Object.assign(Object.create(proto), value);
}

export function deepFreeze(value) {
  let frozen = value;
  switch (getTypeOf(frozen)) {
    case "object":
      Reflect.ownKeys(frozen).forEach(key => {
        frozen[key] = deepFreeze(frozen[key]);
      });
      Object.freeze(frozen);
      break;
    case "array":
      for (let i = 0; i < frozen.length; i++) {
        frozen[i] = deepFreeze(frozen[i]);
      }
      Object.freeze(frozen);
      break;
    case "map":
    case "set":
      frozen = freezeCollection(frozen, true);
      break;
    default:
  }
  return frozen;
}

export function freezeCollection(collection, deep) {
  const isSet = collection instanceof Set;
  let frozen = collection;
  // freeze all values first if requested
  if (deep) {
    // since we can't update Set value like Map
    // need to keep a copy of all frozen values
    // so if any frozen value is different to original
    // we can make copy the final frozen collection
    const setCopy = isSet && new Set();
    let hasDiff = false;
    frozen.forEach((value, key, coll) => {
      const newVal = deepFreeze(value);
      if (isSet) {
        setCopy.add(newVal);
      }
      if (!isSame(newVal, value)) {
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
  frozen = toFreezableCollection(frozen);
  return Object.freeze(
    // override methods that mutate collection
    Object.defineProperties(frozen, {
      [isSet ? "add" : "set"]: { value: forbidden },
      delete: { value: forbidden },
      clear: { value: forbidden },
    })
  );
}

function isSame(v1, v2) {
  return v1 === v2 || Object.is(v1, v2);
}

function forbidden() {
  throw new TypeError(`Can not mutate frozen ${getTypeOf(this)}`);
}

// there doesn't seem to be a way to really freeze Map/Set objects
// because user can always mutate the object by doing something
// like Map.prototype.clear.call(mapOrSet). Some libraries out there
// are actually doing things like this for various reasons.
// Only way to prevent is to monkey patch Map/Set which is not great.
// That can potentially cause other issues.
// This method will return a Map/Set like object that is
// - considered a Map/Set: mapLike instanceOf Map === true
// - throws error: Map.prototype.clear.call(mapLike)
function toFreezableCollection(collection) {
  if (collection[symbols.freezable]) {
    return collection;
  }
  const proto = Object.getPrototypeOf(collection);
  const descriptors = mapOwnValues(
    Object.getOwnPropertyDescriptors(proto),
    (desc) => mapOwnValues(desc, (value) => {
      // bind function to original collection
      const isFn = value instanceof Function;
      return isFn ? value.bind(collection) : value;
    })
  );
  descriptors[symbols.freezable] = {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  };
  return Object.create(proto, descriptors);
}

function mapOwnValues(obj, doMap) {
  const mapped = {};
  Reflect.ownKeys(obj).forEach(key => {
    mapped[key] = doMap(obj[key], key, obj);
  });
  return mapped;
}
