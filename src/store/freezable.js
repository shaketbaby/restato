const freezeSymbol = Symbol("freeze");
const freezableSymbol = Symbol("freezable");

const FreezableTypes = [
  getFreezableType(Date),
  getFreezableType(Map),
  getFreezableType(Set),
];

export function freeze(target) {
  return (target[freezeSymbol] || Object.freeze)(target);
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
export function toFreezable(original) {
  if (original[freezableSymbol]) {
    return original;
  }

  const freezableType = FreezableTypes.find(
    t => (original instanceof Object.getPrototypeOf(t).constructor)
  );

  if (!freezableType) {
    throw new TypeError("Non freezable value: " + original);
  }

  // prevent original value from being used directly
  freezableType[freezeSymbol](Object.create(original));

  const proto = Object.create(freezableType, {
    [freezableSymbol]: { value: original }
  });

  return Object.create(proto);
}

function getFreezableType(type) {
  const descriptors = mapOwnValues(
    Object.getOwnPropertyDescriptors(type.prototype),
    (desc) => mapOwnValues(desc, (value) => {
      if (value instanceof Function) {
        // return a function that always calls original function
        // with this set to the original non-freezable instance
        const fn = function (...args) {
          return value.apply(this[freezableSymbol], args);
        };
        return Object.defineProperties(fn, {
          length: { value: value.length },
          name: { value: value.name },
        });
      }
      return value;
    })
  );
  descriptors[freezeSymbol] = { value: getFreeze(type) };
  return Object.freeze(Object.create(type.prototype, descriptors));
}

function getFreeze(type) {
  const frozenProps = getFrozenDescriptors(type);
  return function freeze(target) {
    const proto = Object.getPrototypeOf(target);
    // override mutating methods
    Object.defineProperties(proto, frozenProps);
    // freeze proto
    Object.freeze(proto);
    // freeze target itself
    return Object.freeze(target);
  }
}

function getFrozenDescriptors(type) {
  let props;

  if (type === Date) {
    props = Object.getOwnPropertyNames(Date.prototype);
    props = props.filter(k => k.startsWith("set"));
  } else {
    // Map or Set
    const addOrSet = type === Set ? "add" : "set";
    props = [addOrSet, "delete", "clear"];
  }

  const desc = { value: frozen };
  return Object.fromEntries(props.map(p => [p, desc]));
}

function frozen() {
  const tag = this[Symbol.toStringTag] ||
    Object.getPrototypeOf(this)?.constructor?.name;
  throw new TypeError(`Can not mutate frozen ${tag || "Object"}`);
}

function mapOwnValues(obj, doMap) {
  const mapped = {};
  Reflect.ownKeys(obj).forEach(key => {
    mapped[key] = doMap(obj[key], key, obj);
  });
  return mapped;
}
