const FreezableSymbol = Symbol("freezable");

const FreezableTypes = [
  buildFreezableType(Map),
  buildFreezableType(Set),
];

// there doesn't seem to be a way to really freeze Map/Set objects
// because user can always mutate the object by doing something
// like Map.prototype.clear.call(mapOrSet). Some libraries out there
// are actually doing things like this for various reasons.
// Only way to prevent is to monkey patch Map/Set which is not great.
// That can potentially cause other issues.
// This method will return a Map/Set like object that is
// - considered a Map/Set: mapLike instanceOf Map === true
// - throws error: Map.prototype.clear.call(mapLike)
export function toFreezable(original) {
  if (original[FreezableSymbol]) {
    return original;
  }

  const freezableType = FreezableTypes.find(
    t => (original instanceof Object.getPrototypeOf(t).constructor)
  );

  if (!freezableType) {
    throw new TypeError("Non freezable value: " + original);
  }

  // prevent raw value from being used directly
  Object.freeze(Object.setPrototypeOf(original, null));

  const proto = Object.create(freezableType, {
    [FreezableSymbol]: {
      configurable: false,
      enumerable: false,
      writable: false,
      value: original,
    }
  });

  return Object.create(proto);
}

function buildFreezableType(Constructor) {
  return Object.freeze(
    Object.create(Constructor.prototype, mapOwnValues(
      Object.getOwnPropertyDescriptors(Constructor.prototype),
      (desc) => mapOwnValues(desc, (value) => {
        if (value instanceof Function) {
          // return a function that always calls original function
          // with this set to the original non-freezable instance
          const fn = function(...args) {
            return value.apply(this[FreezableSymbol], args);
          };
          return Object.defineProperty(fn, "name", { value: value.name });
        }
        return value;
      }))
    )
  );
}

function mapOwnValues(obj, doMap) {
  const mapped = {};
  Reflect.ownKeys(obj).forEach(key => {
    mapped[key] = doMap(obj[key], key, obj);
  });
  return mapped;
}
